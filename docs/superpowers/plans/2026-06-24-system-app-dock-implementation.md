# System App Dock Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Synapse's main navigation into a system-app Dock backed by one app registry, and migrate public MCP capability names to primary `app_*` tools with legacy aliases.

**Architecture:** The renderer shell will use `activeAppId` and app registry metadata instead of fixed top tab constants. MCP naming will use canonical `app.<namespace>...` action ids, primary `app_*` tools, and legacy alias mappings that dispatch to the same canonical action.

**Tech Stack:** Electron 41, Vite 8, React 19, TypeScript 6, shadcn/ui, Tailwind CSS 4, Vitest, pnpm monorepo.

---

## Scope Notes

This plan implements the approved spec in two milestones:

1. Renderer shell and registry unification.
2. MCP capability renaming, alias compatibility, and built-in skill docs.

Do not redesign individual business module UIs. Do not physically move large module folders unless a task explicitly says so. Do not remove legacy MCP aliases.

## File Structure

### Renderer Shell And Registry

- Modify `desktop/src/modules/apps/types.ts`
  - Add new system app ids.
  - Add `namespace`, `dock`, `window`, and `capabilities` metadata.
  - Keep existing fixed system app properties.
- Create `desktop/src/modules/apps/dock.ts`
  - Derive Dock apps from the system app registry.
  - Keep workflow visibility filtering outside the registry definition.
- Modify `desktop/src/modules/apps/definitions.ts`
  - Include new definitions for Agent, Workflow, Drive, Automation, Launcher, and Settings.
  - Preserve pure definitions without icon imports.
- Modify `desktop/src/modules/apps/registry.ts`
  - Include full manifests with icons.
  - Export helpers for Dock and Launcher ordering.
- Create app definition and manifest files:
  - `desktop/src/modules/agent/app-definition.ts`
  - `desktop/src/modules/agent/app-manifest.ts`
  - `desktop/src/modules/workflow/app-definition.ts`
  - `desktop/src/modules/workflow/app-manifest.ts`
  - `desktop/src/modules/drive/app-definition.ts`
  - `desktop/src/modules/drive/app-manifest.ts`
  - `desktop/src/modules/automation/app-definition.ts`
  - `desktop/src/modules/automation/app-manifest.ts`
  - `desktop/src/modules/settings/app-definition.ts`
  - `desktop/src/modules/settings/app-manifest.ts`
  - `desktop/src/modules/apps/launcher-app-definition.ts`
  - `desktop/src/modules/apps/launcher-app-manifest.ts`
- Create icon assets only if needed:
  - Prefer existing module assets.
  - If a module has no icon asset, use an existing built-in app icon as a temporary local asset import only when tests do not inspect exact visual identity.
- Modify `desktop/src/modules/apps/components/app-launcher-grid.tsx`
  - Remove hardcoded `appDescriptions` dependency on exact old app ids or update it for the full system app set.
- Create `desktop/src/app-shell/components/app-shell-dock.tsx`
  - Render pinned app icon buttons with shadcn Tooltip.
  - No custom colors, no inline styles, no marketing/helper copy.
- Modify `desktop/src/app-shell/components/app-shell-layout.tsx`
  - Rename prop concept from `navigation` to `dock` if practical, or pass Dock through the existing `navigation` prop for a smaller first change.
- Modify `desktop/src/app-shell/navigation.ts`
  - Rename public concepts from app tab to active app where possible.
  - Keep compatibility request helpers such as settings open and agent session open.
- Modify `desktop/src/App.tsx`
  - Replace `APP_NAVIGATION_TABS` / `activeTab` with registry-backed `activeAppId`.
  - Route `launcher` to the existing Apps/Launcher module.
  - Route all modules through `SystemAppContent`.
- Modify `desktop/config.ts`
  - Remove or deprecate `APP_NAVIGATION_TABS`.
  - Replace `DEFAULT_APP_NAVIGATION_TAB_ID` with `DEFAULT_SYSTEM_APP_ID = "launcher"` and Chinese comment.
- Modify tests:
  - `desktop/src/modules/apps/__tests__/registry.test.ts`
  - `desktop/src/__tests__/App.navigation-order.test.ts`
  - `desktop/src/__tests__/App.workflow-entry.test.tsx`
  - `desktop/src/__tests__/App.no-repository.test.tsx`
  - Add `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`

### MCP Naming

- Modify `desktop/synapse-capabilities/shared/naming.ts`
  - Keep existing `capabilityIdToMcpTool`.
  - Add legacy alias helper types/functions if useful.
- Modify `desktop/synapse-capabilities/shared/registry.ts`
  - Build primary `app_*` tool actions.
  - Add legacy alias action mapping.
  - Export helper to resolve aliases.
- Modify domain files:
  - `desktop/database/shared/capability-registry.ts`
  - `desktop/synapse-capabilities/shared/drive-domain.ts`
  - `desktop/synapse-capabilities/shared/automation-domain.ts`
  - `desktop/synapse-capabilities/shared/workflow-domain.ts`
  - `desktop/synapse-capabilities/shared/content-domain.ts`
  - `desktop/synapse-capabilities/shared/variable-domain.ts`
  - `desktop/synapse-capabilities/shared/repository-domain.ts`
  - `desktop/synapse-capabilities/shared/model-price-domain.ts`
  - Existing `desktop/synapse-capabilities/shared/app-domain.ts` for already app-scoped apps.
- Modify tool builder outputs in the same domain files:
  - Primary tool names become `app_*`.
  - Legacy alias tools are returned with descriptions such as `Legacy alias for app_drive_file_upload.`
- Modify `desktop/electron/database/mcp-server.ts` only if direct resolution is needed there; prefer keeping resolution in shared registry / MCP RPC code.
- Modify `desktop/database/shared/mcp-rpc.ts`
  - Ensure `tools/list` returns primary tools and legacy aliases.
  - Ensure `tools/call` accepts both and dispatches canonical `app.*` action ids.
- Update tests:
  - `desktop/electron/database/__tests__/mcp-server.test.ts`
  - `desktop/synapse-capabilities/shared/drive-domain.test.ts`
  - `desktop/synapse-capabilities/shared/content-domain.test.ts`
  - `desktop/synapse-capabilities/shared/app-domain.test.ts`
  - Add or update equivalent tests for automation/workflow/variable/repository/model-price.
- Update built-in skill docs:
  - `desktop/resources/templates/skills/synapse-skill/content.md`
  - `desktop/resources/templates/skills/synapse-skill/files/database/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/database/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/drive/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/drive/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/automation/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/workflow/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/workflow/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/content/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/content/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/variable/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/variable/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/repository/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/repository/api-reference.md`
  - `desktop/resources/templates/skills/synapse-skill/files/model-price/index.md`
  - `desktop/resources/templates/skills/synapse-skill/files/model-price/api-reference.md`

### Release Notes

- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing note about the main navigation becoming an app Dock and MCP tools gaining new app-scoped names with legacy compatibility.

## Task 1: Extend System App Types And Registry Metadata

**Files:**
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Test: `desktop/src/modules/apps/__tests__/registry.test.ts`

- [ ] **Step 1: Write failing registry metadata tests**

Replace the first test in `desktop/src/modules/apps/__tests__/registry.test.ts` with expectations for the full app set and metadata:

```ts
it("lists all system apps in launcher order", () => {
  expect(listSystemApps().map((app) => app.id)).toEqual([
    "agent",
    "workflow",
    "drive",
    "automation",
    "launcher",
    "settings",
    "resource-repository",
    "git",
    "database",
    "document-template",
    "terminal",
    "screenshot",
    "editor-scan",
    "usage-monitor",
    "model-price",
  ])
})

it("exposes stable namespaces and Dock metadata", () => {
  expect(getSystemAppManifest("launcher")).toMatchObject({
    id: "launcher",
    namespace: "launcher",
    name: "应用",
    dock: { pinnedByDefault: true, order: 50 },
  })
  expect(getSystemAppManifest("database")).toMatchObject({
    namespace: "database",
    capabilities: {
      primaryMcpPrefix: "app_database",
      legacyMcpPrefixes: ["database"],
    },
  })
  expect(getSystemAppManifest("resource-repository")).toMatchObject({
    namespace: "resource_repository",
    capabilities: {
      primaryMcpPrefix: "app_resource_repository",
      legacyMcpPrefixes: ["content"],
    },
  })
})
```

Update the "marks every system app as fixed" test to assert:

```ts
expect(app.namespace.length).toBeGreaterThan(0)
expect(app.dock).toBeDefined()
expect(app.window).toBeDefined()
expect(app.capabilities?.primaryMcpPrefix).toMatch(/^app_[a-z0-9_]+$/)
```

- [ ] **Step 2: Run the failing registry test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because new app ids and metadata fields do not exist yet.

- [ ] **Step 3: Extend app types**

In `desktop/src/modules/apps/types.ts`, update `SYSTEM_APP_IDS`:

```ts
export const SYSTEM_APP_IDS = [
  "agent",
  "workflow",
  "drive",
  "automation",
  "launcher",
  "settings",
  "resource-repository",
  "git",
  "database",
  "document-template",
  "terminal",
  "screenshot",
  "editor-scan",
  "usage-monitor",
  "model-price",
] as const
```

Add metadata types:

```ts
export type SynapseSystemAppNamespace =
  | "agent"
  | "workflow"
  | "drive"
  | "automation"
  | "launcher"
  | "settings"
  | "resource_repository"
  | "git"
  | "database"
  | "document_template"
  | "terminal"
  | "screenshot"
  | "editor_scan"
  | "usage_monitor"
  | "model_price"

export type SynapseSystemAppDockVisibility = "always" | "workflow-entry-enabled"

export type SynapseSystemAppDockMetadata = {
  readonly pinnedByDefault: boolean
  readonly order: number
  readonly visibility?: SynapseSystemAppDockVisibility
}

export type SynapseSystemAppWindowMetadata = {
  readonly openable: boolean
}

export type SynapseSystemAppCapabilityMetadata = {
  readonly primaryMcpPrefix: `app_${string}`
  readonly legacyMcpPrefixes?: readonly string[]
}
```

Extend `SynapseSystemAppDefinition`:

```ts
export type SynapseSystemAppDefinition = {
  readonly id: SynapseSystemAppId
  readonly namespace: SynapseSystemAppNamespace
  readonly type: "system"
  readonly name: string
  readonly windowTitle: string
  readonly defaultView?: SynapseSystemAppDefaultView
  readonly dock: SynapseSystemAppDockMetadata
  readonly window: SynapseSystemAppWindowMetadata
  readonly capabilities?: SynapseSystemAppCapabilityMetadata
  readonly removable: false
  readonly renameable: false
  readonly iconEditable: false
}
```

- [ ] **Step 4: Update existing app definitions**

For each existing app definition, add metadata. Example for `desktop/src/modules/database/app-definition.ts`:

```ts
export const databaseAppDefinition = {
  id: "database",
  namespace: "database",
  type: "system",
  name: "本地数据库",
  windowTitle: "本地数据库",
  dock: { pinnedByDefault: false, order: 230 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_database",
    legacyMcpPrefixes: ["database"],
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Use these mappings:

```ts
resource-repository: namespace "resource_repository", order 210, legacy ["content"]
git: namespace "git", order 220, no legacy unless tools are added
database: namespace "database", order 230, legacy ["database"]
document-template: namespace "document_template", order 240, no legacy
terminal: namespace "terminal", order 250, no legacy
screenshot: namespace "screenshot", order 260, no legacy
editor-scan: namespace "editor_scan", order 270, no legacy
usage-monitor: namespace "usage_monitor", order 280, no legacy
model-price: namespace "model_price", order 290, legacy ["model_price"]
```

- [ ] **Step 5: Add new first-class system app definitions**

Create new app definition files with this pattern:

```ts
import type { SynapseSystemAppDefinition } from "../apps/types"

export const agentAppDefinition = {
  id: "agent",
  namespace: "agent",
  type: "system",
  name: "对话",
  windowTitle: "对话",
  dock: { pinnedByDefault: true, order: 10 },
  window: { openable: false },
  capabilities: { primaryMcpPrefix: "app_agent" },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Use these values:

```ts
workflow: name "工作流", order 20, visibility "workflow-entry-enabled", capabilities "app_workflow", legacy ["workflow"]
drive: name "云盘", order 30, capabilities "app_drive", legacy ["drive"]
automation: name "自动化", order 40, capabilities "app_automation", legacy ["automation"]
settings: name "设置", order 60, capabilities "app_settings"
launcher: name "应用", order 50, capabilities "app_launcher"
```

For `launcher`, place the definition in `desktop/src/modules/apps/launcher-app-definition.ts` and import type from `./types`.

- [ ] **Step 6: Add manifests for new apps**

For each new app, create a manifest file. Example:

```ts
import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { agentAppDefinition } from "./app-definition"

export const agentAppManifest = {
  ...agentAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

If a module has no asset yet, use `../database/assets/icon.png` only as a temporary import for this structural pass. Do not create generated image assets in this task.

For `launcher`, put the manifest in `desktop/src/modules/apps/launcher-app-manifest.ts`:

```ts
import icon from "../database/assets/icon.png"
import type { SynapseSystemAppManifest } from "./types"
import { launcherAppDefinition } from "./launcher-app-definition"

export const launcherAppManifest = {
  ...launcherAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 7: Register all definitions and manifests**

Update `desktop/src/modules/apps/definitions.ts` imports and `systemAppDefinitions` order:

```ts
const systemAppDefinitions = [
  agentAppDefinition,
  workflowAppDefinition,
  driveAppDefinition,
  automationAppDefinition,
  launcherAppDefinition,
  settingsAppDefinition,
  resourceRepositoryAppDefinition,
  gitAppDefinition,
  databaseAppDefinition,
  documentTemplateAppDefinition,
  terminalAppDefinition,
  screenshotAppDefinition,
  editorScanAppDefinition,
  usageMonitorAppDefinition,
  modelPriceAppDefinition,
] as const satisfies readonly SynapseSystemAppDefinition[]
```

Update `desktop/src/modules/apps/registry.ts` with matching manifest order.

- [ ] **Step 8: Run registry test to verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit registry metadata**

```bash
git add desktop/src/modules/apps desktop/src/modules/agent/app-definition.ts desktop/src/modules/agent/app-manifest.ts desktop/src/modules/workflow/app-definition.ts desktop/src/modules/workflow/app-manifest.ts desktop/src/modules/drive/app-definition.ts desktop/src/modules/drive/app-manifest.ts desktop/src/modules/automation/app-definition.ts desktop/src/modules/automation/app-manifest.ts desktop/src/modules/settings/app-definition.ts desktop/src/modules/settings/app-manifest.ts
git commit -m "feat(desktop): register shell modules as system apps"
```

## Task 2: Add Registry-Backed Dock And Launcher Routing

**Files:**
- Create: `desktop/src/modules/apps/dock.ts`
- Create: `desktop/src/app-shell/components/app-shell-dock.tsx`
- Modify: `desktop/src/app-shell/components/app-shell-layout.tsx`
- Modify: `desktop/src/modules/apps/index.tsx`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Modify: `desktop/src/modules/apps/components/app-launcher-grid.tsx`
- Test: `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`
- Test: `desktop/src/modules/apps/__tests__/app-launcher.test.tsx`

- [ ] **Step 1: Write failing Dock tests**

Create `desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { AppShellDock } from "../app-shell-dock"

const apps = [
  { id: "agent", name: "对话", icon: "/agent.png" },
  { id: "launcher", name: "应用", icon: "/launcher.png" },
] as const

describe("AppShellDock", () => {
  it("renders pinned app icon buttons and switches active app", async () => {
    const onValueChange = vi.fn()
    render(<AppShellDock apps={apps} value="agent" onValueChange={onValueChange} />)

    expect(screen.getByRole("button", { name: "对话" })).toHaveAttribute("aria-current", "page")
    await userEvent.click(screen.getByRole("button", { name: "应用" }))
    expect(onValueChange).toHaveBeenCalledWith("launcher")
  })
})
```

- [ ] **Step 2: Run failing Dock test**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx
```

Expected: FAIL because `AppShellDock` does not exist.

- [ ] **Step 3: Add Dock app derivation helper**

Create `desktop/src/modules/apps/dock.ts`:

```ts
import type { SynapseSystemAppManifest } from "./types"

export function listDockApps(
  apps: readonly SynapseSystemAppManifest[],
  options: { readonly workflowEntryVisible: boolean },
): readonly SynapseSystemAppManifest[] {
  return apps
    .filter((app) => app.dock.pinnedByDefault)
    .filter((app) => app.dock.visibility !== "workflow-entry-enabled" || options.workflowEntryVisible)
    .toSorted((left, right) => left.dock.order - right.dock.order)
}
```

- [ ] **Step 4: Add AppShellDock component**

Create `desktop/src/app-shell/components/app-shell-dock.tsx`:

```tsx
import type { SynapseSystemAppId } from "@/modules/apps/types"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"
import { cn } from "@/lib/utils"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

type AppShellDockApp = Pick<SynapseSystemAppManifest, "id" | "name" | "icon">

type AppShellDockProps = {
  readonly apps: readonly AppShellDockApp[]
  readonly value: SynapseSystemAppId
  readonly onValueChange: (value: SynapseSystemAppId) => void
}

export function AppShellDock({ apps, value, onValueChange }: AppShellDockProps) {
  return (
    <TooltipProvider>
      <nav data-track="app-shell-dock" className="flex min-w-0 items-center justify-center gap-1 overflow-hidden">
        {apps.map((app) => {
          const active = app.id === value
          return (
            <Tooltip key={app.id}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    "flex size-8 items-center justify-center rounded-md outline-none transition-colors hover:bg-accent focus-visible:ring-3 focus-visible:ring-ring/50",
                    active && "bg-accent text-accent-foreground",
                  )}
                  aria-label={app.name}
                  aria-current={active ? "page" : undefined}
                  onClick={() => onValueChange(app.id)}
                >
                  <img src={app.icon} alt="" className="size-5 object-cover" draggable={false} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{app.name}</TooltipContent>
            </Tooltip>
          )
        })}
      </nav>
    </TooltipProvider>
  )
}
```

- [ ] **Step 5: Wire launcher app content**

Modify `desktop/src/modules/apps/components/system-app-content.tsx` so the beginning of `SystemAppContent` handles shell modules:

```tsx
if (appId === "agent") return <AgentModule />
if (appId === "workflow") return <WorkflowModule />
if (appId === "drive") return <DriveModule />
if (appId === "automation") return <AutomationModule />
if (appId === "settings") return <SettingsModule />
if (appId === "launcher") {
  return (
    <AppsModule
      pendingContentOpenRequest={resourceContentOpenRequest}
      onPendingContentOpenRequestConsumed={onResourceContentOpenRequestConsumed}
    />
  )
}
```

Import the modules from their existing paths. If this creates a circular import with `AppsModule`, extract the launcher grid portion from `desktop/src/modules/apps/index.tsx` into `desktop/src/modules/apps/launcher-module.tsx` and route `launcher` to `LauncherModule` instead.

- [ ] **Step 6: Update Launcher grid descriptions**

In `desktop/src/modules/apps/components/app-launcher-grid.tsx`, extend `appDescriptions` to include every app id:

```ts
const appDescriptions = {
  agent: "Agent 会话",
  workflow: "流程编排",
  drive: "文件与分享",
  automation: "触发器与运行",
  launcher: "系统应用",
  settings: "系统配置",
  "resource-repository": "技能、规则、提示词",
  git: "仓库、提交、同步",
  database: "表、字段、数据记录",
  "document-template": "模板与 JSON",
  terminal: "会话、命令输入",
  screenshot: "屏幕截图",
  "editor-scan": "编辑器扫描与安装状态",
  "usage-monitor": "CC 与 Codex 用量",
  "model-price": "模型价格规则",
} satisfies Record<SynapseSystemAppId, string>
```

- [ ] **Step 7: Run Dock and launcher tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx desktop/src/modules/apps/__tests__/app-launcher.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Dock component**

```bash
git add desktop/src/modules/apps/dock.ts desktop/src/app-shell/components/app-shell-dock.tsx desktop/src/modules/apps/components/system-app-content.tsx desktop/src/modules/apps/components/app-launcher-grid.tsx desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx desktop/src/modules/apps/__tests__/app-launcher.test.tsx
git commit -m "feat(desktop): add system app dock"
```

## Task 3: Replace Top Tabs With Active App Shell State

**Files:**
- Modify: `desktop/config.ts`
- Modify: `desktop/src/App.tsx`
- Modify: `desktop/src/app-shell/navigation.ts`
- Modify: `desktop/src/app-shell/components/app-shell-layout.tsx`
- Test: `desktop/src/__tests__/App.navigation-order.test.ts`
- Test: `desktop/src/__tests__/App.workflow-entry.test.tsx`
- Test: `desktop/src/__tests__/App.no-repository.test.tsx`

- [ ] **Step 1: Replace navigation-order test**

Replace `desktop/src/__tests__/App.navigation-order.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import { listDockApps } from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"

describe("app Dock order", () => {
  it("keeps pinned apps in the requested left-to-right order", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: true }).map((app) => app.id)).toEqual([
      "agent",
      "workflow",
      "drive",
      "automation",
      "launcher",
      "settings",
    ])
  })

  it("hides workflow when the workflow entry is not visible", () => {
    expect(listDockApps(listSystemApps(), { workflowEntryVisible: false }).map((app) => app.id)).toEqual([
      "agent",
      "drive",
      "automation",
      "launcher",
      "settings",
    ])
  })
})
```

- [ ] **Step 2: Run failing shell tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/__tests__/App.navigation-order.test.ts desktop/src/__tests__/App.workflow-entry.test.tsx desktop/src/__tests__/App.no-repository.test.tsx
```

Expected: FAIL because App still uses `APP_NAVIGATION_TABS` and `apps`.

- [ ] **Step 3: Update config constants**

In `desktop/config.ts`, replace the navigation constants with:

```ts
// 默认激活的系统应用：主窗口有内容仓库时默认进入应用启动器。
export const DEFAULT_SYSTEM_APP_ID = "launcher"
```

Keep `DEFAULT_APP_NAVIGATION_TAB_ID` as a compatibility export only if other files still import it during this task:

```ts
// 旧顶部 tab 默认值兼容别名：迁移期保留，后续代码应使用 DEFAULT_SYSTEM_APP_ID。
export const DEFAULT_APP_NAVIGATION_TAB_ID = DEFAULT_SYSTEM_APP_ID
```

- [ ] **Step 4: Update navigation event names cautiously**

In `desktop/src/app-shell/navigation.ts`, keep exported function names for compatibility but change internal naming:

```ts
let currentAppId = DEFAULT_SYSTEM_APP_ID

function publishActiveAppTab(appId: string): void {
  currentAppId = appId
  window.dispatchEvent(new CustomEvent(APP_TAB_CHANGED_EVENT, {
    detail: appId,
  }))
}

function readCurrentAppTab(): string {
  return currentAppId
}
```

Do not rename public exports in this task unless all callers are updated in the same edit.

- [ ] **Step 5: Update App.tsx active state**

In `desktop/src/App.tsx`:

1. Remove `AppShellNavigation` import.
2. Add imports:

```ts
import { AppShellDock } from "@/app-shell/components/app-shell-dock"
import { listDockApps } from "@/modules/apps/dock"
import { listSystemApps } from "@/modules/apps/registry"
import { SystemAppContent } from "@/modules/apps/components/system-app-content"
import type { SynapseSystemAppId } from "@/modules/apps/types"
```

3. Replace tab types:

```ts
type AppTabId = SynapseSystemAppId
```

4. Change default:

```ts
const DEFAULT_APP_TAB: AppTabId = DEFAULT_SYSTEM_APP_ID as SynapseSystemAppId
```

5. Replace `tabs` memo with:

```ts
const dockApps = useMemo(
  () => listDockApps(listSystemApps(), { workflowEntryVisible }),
  [workflowEntryVisible],
)
```

6. Replace content branches with:

```tsx
<ErrorBoundary fallbackTitle="应用出现问题">
  <SystemAppContent
    appId={activeTab}
    resourceContentOpenRequest={pendingAppContentOpenRequest}
    onResourceContentOpenRequestConsumed={(requestId) => {
      setPendingAppContentOpenRequest((current) => current?.requestId === requestId ? null : current)
    }}
  />
</ErrorBoundary>
```

Preserve the existing `AgentModule` pending session behavior by either:

- Adding `agentPendingSession` props to `SystemAppContent`, or
- Keeping the current Agent branch until Task 4 extracts full launcher routing.

Prefer adding optional props to `SystemAppContent`:

```ts
readonly pendingAgentSession?: OpenAgentSessionPayload | null
readonly onPendingAgentSessionConsumed?: () => void
```

and pass them to `AgentModule`.

7. Replace layout navigation prop:

```tsx
navigation={
  <AppShellDock
    apps={dockApps}
    value={activeTab}
    onValueChange={(value) => setActiveTab(value, "navigation")}
  />
}
```

- [ ] **Step 6: Update old `"apps"` transitions to `"launcher"`**

In `desktop/src/App.tsx`, change content-open routing:

```ts
setActiveTab("launcher", "notification")
```

In workflow hiding fallback:

```ts
setActiveTab(DEFAULT_APP_TAB, "cheat-code")
```

- [ ] **Step 7: Run shell tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/__tests__/App.navigation-order.test.ts desktop/src/__tests__/App.workflow-entry.test.tsx desktop/src/__tests__/App.no-repository.test.tsx desktop/src/modules/apps/__tests__/system-app-window-app.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit shell state migration**

```bash
git add desktop/config.ts desktop/src/App.tsx desktop/src/app-shell/navigation.ts desktop/src/app-shell/components/app-shell-layout.tsx desktop/src/__tests__/App.navigation-order.test.ts desktop/src/__tests__/App.workflow-entry.test.tsx desktop/src/__tests__/App.no-repository.test.tsx desktop/src/modules/apps/components/system-app-content.tsx
git commit -m "feat(desktop): route main shell by system app id"
```

## Task 4: Convert MCP Canonical IDs To `app.*`

**Files:**
- Modify: `desktop/database/shared/capability-registry.ts`
- Modify: `desktop/synapse-capabilities/shared/drive-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/automation-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/workflow-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/content-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/variable-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/repository-domain.ts`
- Modify: `desktop/synapse-capabilities/shared/model-price-domain.ts`
- Test: `desktop/synapse-capabilities/shared/drive-domain.test.ts`
- Test: `desktop/synapse-capabilities/shared/content-domain.test.ts`

- [ ] **Step 1: Write failing MCP canonical tests**

In `desktop/synapse-capabilities/shared/drive-domain.test.ts`, update the first test assertions:

```ts
expect(toolNames.filter((name) => name.startsWith("app_drive_")).length).toBeGreaterThan(0)
expect(MCP_TOOL_ACTIONS.app_drive_file_upload).toBe("app.drive.file.upload")
expect(MCP_TOOL_ACTIONS.drive_file_upload).toBe("app.drive.file.upload")
expect(getActionDomainId("app.drive.item.list")).toBe("app")
```

In `desktop/synapse-capabilities/shared/content-domain.test.ts`, add:

```ts
it("uses resource repository app tool names with content aliases", () => {
  const tools = new Map(buildContentTools().map((tool) => [tool.name, tool]))
  expect(tools.has("app_resource_repository_skill_create")).toBe(true)
  expect(tools.has("content_skill_create")).toBe(true)
})
```

- [ ] **Step 2: Run failing MCP domain tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/synapse-capabilities/shared/content-domain.test.ts
```

Expected: FAIL because primary app tool names and canonical app ids are not in place.

- [ ] **Step 3: Update database canonical ids**

In `desktop/database/shared/capability-registry.ts`, change ids from:

```ts
{ id: "database.row.create", ... }
```

to:

```ts
{ id: "app.database.row.create", ... }
```

Apply to every database capability. Keep titles and descriptions unchanged.

- [ ] **Step 4: Update Drive canonical ids**

In `desktop/synapse-capabilities/shared/drive-domain.ts`, change every id from:

```ts
"drive.item.list"
```

to:

```ts
"app.drive.item.list"
```

Do this for all drive capabilities including direct link, trash, site, and reorganization capabilities.

- [ ] **Step 5: Update other domains**

Use these mappings:

```text
automation.*   -> app.automation.*
workflow.*     -> app.workflow.*
content.*      -> app.resource_repository.*
variable.*     -> app.settings.variable.*
repository.*   -> app.settings.repository.*
model_price.*  -> app.model_price.*
```

Example for content:

```ts
{ id: "app.resource_repository.skill.create" as CapabilityId, ... }
```

Example for variable:

```ts
{ id: "app.settings.variable.item.upsert" as CapabilityId, ... }
```

- [ ] **Step 6: Update domain id values**

Update each `CapabilityDomainDefinition.id`:

```ts
DATABASE_DOMAIN.id = "app"
DRIVE_DOMAIN.id = "app"
AUTOMATION_DOMAIN.id = "app"
WORKFLOW_DOMAIN.id = "app"
CONTENT_DOMAIN.id = "app"
VARIABLE_DOMAIN.id = "app"
REPOSITORY_DOMAIN.id = "app"
MODEL_PRICE_DOMAIN.id = "app"
```

If duplicate domain ids break assumptions, keep domain ids unchanged for grouping but update `getActionDomainId` tests to expect the current grouping. The canonical action id must still be `app.*`.

- [ ] **Step 7: Run TypeScript-focused tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/synapse-capabilities/shared/content-domain.test.ts desktop/synapse-capabilities/shared/app-domain.test.ts
```

Expected: Tests still fail until primary names and aliases are added in Task 5, but there should be no TypeScript syntax errors.

- [ ] **Step 8: Commit canonical ids**

```bash
git add desktop/database/shared/capability-registry.ts desktop/synapse-capabilities/shared/*-domain.ts desktop/synapse-capabilities/shared/*-domain.test.ts
git commit -m "feat(mcp): move system capabilities to app namespace"
```

## Task 5: Add Primary `app_*` MCP Tools And Legacy Aliases

**Files:**
- Modify: `desktop/synapse-capabilities/shared/naming.ts`
- Modify: `desktop/synapse-capabilities/shared/registry.ts`
- Modify: `desktop/database/shared/mcp-tools.ts`
- Modify domain files from Task 4 tool builders.
- Modify: `desktop/database/shared/mcp-rpc.ts`
- Test: `desktop/electron/database/__tests__/mcp-server.test.ts`
- Test: `desktop/synapse-capabilities/shared/drive-domain.test.ts`
- Test: `desktop/synapse-capabilities/shared/content-domain.test.ts`

- [ ] **Step 1: Add alias helper**

In `desktop/synapse-capabilities/shared/naming.ts`, add:

```ts
export function legacyToolNameForPrimary(primaryName: string, legacyPrefix: string, primaryPrefix: string): string {
  if (!primaryName.startsWith(`${primaryPrefix}_`)) {
    throw new Error(`Primary tool ${primaryName} does not start with ${primaryPrefix}_`)
  }
  return `${legacyPrefix}_${primaryName.slice(primaryPrefix.length + 1)}`
}
```

- [ ] **Step 2: Build app primary and legacy tool names for database**

In `desktop/database/shared/capability-registry.ts`, replace `buildMcpToolActions` with a primary plus alias map:

```ts
function buildMcpToolActions(): Record<string, string> {
  return Object.fromEntries(
    DATABASE_CAPABILITIES.flatMap((capability) => {
      const primary = capabilityIdToMcpTool(capability.id)
      const legacy = primary.replace(/^app_database_/, "database_")
      return [
        [primary, capability.id],
        [legacy, capability.id],
      ]
    }),
  )
}
```

- [ ] **Step 3: Update database MCP tools list**

In `desktop/database/shared/mcp-tools.ts`, make each existing database tool primary by renaming `name`:

```ts
name: "app_database_table_list"
```

Then append legacy aliases before returning:

```ts
function withDatabaseLegacyAliases(tools: McpTool[]): McpTool[] {
  const aliases = tools.map((tool) => ({
    ...tool,
    name: tool.name.replace(/^app_database_/, "database_"),
    description: `Legacy alias for ${tool.name}. ${tool.description}`,
  }))
  return [...tools, ...aliases]
}

function buildTools(): McpTool[] {
  const primaryTools: McpTool[] = [
    // existing tool objects with app_database_* names
  ]
  return withDatabaseLegacyAliases(primaryTools)
}
```

- [ ] **Step 4: Update other domain tool builders**

For each domain, set primary tool names to `app_*` and append aliases.

Example for Drive:

```ts
function withDriveLegacyAliases(tools: McpToolDefinition[]): McpToolDefinition[] {
  return [
    ...tools,
    ...tools.map((tool) => ({
      ...tool,
      name: tool.name.replace(/^app_drive_/, "drive_"),
      description: `Legacy alias for ${tool.name}. ${tool.description}`,
    })),
  ]
}
```

Use these replacements:

```text
app_drive_                 legacy drive_
app_automation_            legacy automation_
app_workflow_              legacy workflow_
app_resource_repository_   legacy content_
app_settings_variable_     legacy variable_
app_settings_repository_   legacy repository_
app_model_price_           legacy model_price_
```

- [ ] **Step 5: Update MCP server tests**

In `desktop/electron/database/__tests__/mcp-server.test.ts`, change the Automation list test to assert both names:

```ts
expect(payload.result.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
  "app_automation_item_list",
  "app_automation_item_create",
  "app_automation_run_execute",
  "automation_item_list",
]))
```

Change the call test to call the primary name and expect canonical action:

```ts
params: {
  name: "app_automation_item_list",
  arguments: { enabled: true },
}
```

```ts
expect(dispatch).toHaveBeenCalledWith("app.automation.item.list", { enabled: true }, {
  source: "mcp-http",
  actor: { kind: "user", id: "mcp-client:synapse-mcp/http", display: "Synapse MCP HTTP" },
})
```

Add a legacy call test:

```ts
it("calls legacy Automation aliases through the same canonical action", async () => {
  const dispatch = vi.fn(async () => ({ ok: true, data: [] }))
  const { startMcpServer } = await import("../mcp-server")
  const port = await startMcpServer({ dispatch })

  const response = await postJson(port, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "automation_item_list",
      arguments: { enabled: true },
    },
  })

  expect(response.status).toBe(200)
  expect(dispatch).toHaveBeenCalledWith("app.automation.item.list", { enabled: true }, expect.any(Object))
})
```

- [ ] **Step 6: Run MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/database/__tests__/mcp-server.test.ts desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/synapse-capabilities/shared/content-domain.test.ts desktop/synapse-capabilities/shared/app-domain.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit MCP tool aliases**

```bash
git add desktop/synapse-capabilities/shared desktop/database/shared desktop/electron/database/__tests__/mcp-server.test.ts
git commit -m "feat(mcp): expose app tool names with legacy aliases"
```

## Task 6: Update Built-In Synapse Skill MCP Documentation

**Files:**
- Modify all files under `desktop/resources/templates/skills/synapse-skill/files/*`
- Modify: `desktop/resources/templates/skills/synapse-skill/content.md`
- Test: use `rg` checks and focused tests if present.

- [ ] **Step 1: Replace tool names in built-in skill docs**

Run search first:

```bash
rg -n "(database_|drive_|automation_|workflow_|content_|variable_|repository_|model_price_)" desktop/resources/templates/skills/synapse-skill
```

Then replace documented tool names:

```text
database_      -> app_database_
drive_         -> app_drive_
automation_    -> app_automation_
workflow_      -> app_workflow_
content_       -> app_resource_repository_
variable_      -> app_settings_variable_
repository_    -> app_settings_repository_
model_price_   -> app_model_price_
```

Do not blindly replace prose words such as "database table" or "workflow definition" unless they are tool names.

- [ ] **Step 2: Update domain names in skill routing**

In `desktop/resources/templates/skills/synapse-skill/content.md`, keep user-facing domain labels, but make API references app-scoped:

```md
- Database -> app_database_* tools
- Drive -> app_drive_* tools
- Content / Resource Repository -> app_resource_repository_* tools
- Variables -> app_settings_variable_* tools
- Repository settings -> app_settings_repository_* tools
```

- [ ] **Step 3: Verify old names are absent from built-in docs**

Run:

```bash
rg -n "(?<!app_)(database_|drive_|automation_|workflow_|content_|variable_|repository_|model_price_)" desktop/resources/templates/skills/synapse-skill
```

Expected: no matches for old tool-name references. If there are matches inside compatibility explanations, either remove them or explicitly label them as legacy aliases.

- [ ] **Step 4: Commit built-in skill docs**

```bash
git add desktop/resources/templates/skills/synapse-skill
git commit -m "docs(mcp): document app-scoped Synapse tools"
```

## Task 7: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Run verification commands.

- [ ] **Step 1: Add release note**

Append a bullet under the appropriate pending section in `RELEASE_NOTES_PENDING.md`:

```md
- Synapse 主窗口导航升级为系统应用 Dock，原有对话、云盘、自动化、工作流、应用和设置都以系统应用方式进入；Synapse MCP 工具同步提供新的 app 前缀命名，并保留旧工具名兼容已有自动化和工作日志流程。
```

- [ ] **Step 2: Run focused renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/apps/__tests__/registry.test.ts desktop/src/app-shell/components/__tests__/app-shell-dock.test.tsx desktop/src/__tests__/App.navigation-order.test.ts desktop/src/__tests__/App.workflow-entry.test.tsx desktop/src/__tests__/App.no-repository.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run focused MCP tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/database/__tests__/mcp-server.test.ts desktop/synapse-capabilities/shared/drive-domain.test.ts desktop/synapse-capabilities/shared/content-domain.test.ts desktop/synapse-capabilities/shared/app-domain.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full desktop test suite if time allows**

Run:

```bash
pnpm --filter @synapse/desktop test
```

Expected: PASS. If this is too slow or fails outside the changed surface, record the exact failure and run the focused suites from Steps 2 and 3 again before handoff.

- [ ] **Step 6: Commit release note and any final fixes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note system app dock migration"
```

## Self-Review

- Spec coverage:
  - Dock and Launcher are covered by Tasks 1-3.
  - Stable app ids and namespaces are covered by Task 1.
  - MCP primary `app_*` names and legacy aliases are covered by Tasks 4-5.
  - Built-in `synapse-skill` updates are covered by Task 6.
  - Release notes and verification are covered by Task 7.
- Placeholder scan:
  - This plan has no `TBD`, `TODO`, or "implement later" placeholders.
  - Steps that change code include concrete paths, snippets, commands, and expected results.
- Type consistency:
  - `activeAppId` maps to `SynapseSystemAppId`.
  - Stable app id is `launcher`; `apps` appears only as a migration alias.
  - Primary MCP names are `app_*`; old names are aliases.
