# Automation Editor Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Automation card/dialog UI with a Workflow-style list and a dedicated lightweight two-column editor window.

**Architecture:** Keep the existing Automation runtime, data model, IPC create/update/list/run operations, and Action Runtime executor reuse. Add a renderer trigger registry that mirrors `rendererActionRegistry`, add an Electron child-window open path, and move create/edit interaction into a standalone Automation editor renderer entry.

**Tech Stack:** Electron, React, TypeScript, Tailwind CSS, shadcn/Radix primitives, Vitest.

---

## File Structure

Create:

- `desktop/src/automation-triggers/action-registry.ts`: renderer trigger registry type and methods.
- `desktop/src/automation-triggers/builtin-triggers.ts`: register Cron and fixed-interval renderer trigger definitions.
- `desktop/automation-trigger-packages/builtin/cron/schema.ts`: Cron config schema and type.
- `desktop/automation-trigger-packages/builtin/cron/manifest.ts`: Cron manifest.
- `desktop/automation-trigger-packages/builtin/cron/config.renderer.tsx`: Cron config form.
- `desktop/automation-trigger-packages/builtin/cron/index.ts`: Cron exports.
- `desktop/automation-trigger-packages/builtin/interval/schema.ts`: interval config schema and type.
- `desktop/automation-trigger-packages/builtin/interval/manifest.ts`: interval manifest.
- `desktop/automation-trigger-packages/builtin/interval/config.renderer.tsx`: interval config form.
- `desktop/automation-trigger-packages/builtin/interval/index.ts`: interval exports.
- `desktop/electron/services/automation-window-service.ts`: managed create/edit editor windows.
- `desktop/electron/services/__tests__/automation-window-service.test.ts`: window reuse tests.
- `desktop/src/modules/automation/components/automation-list.tsx`: Workflow-style list container.
- `desktop/src/modules/automation/components/automation-list-row.tsx`: single Automation row.
- `desktop/src/modules/automation/editor/editor-app.tsx`: standalone editor window app.
- `desktop/src/modules/automation/editor/editor-form.tsx`: local draft state, validation, save handlers.
- `desktop/src/modules/automation/editor/trigger-executor-builder.tsx`: two-column selection/config builder.
- `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`: editor behavior tests.

Modify:

- `desktop/electron/modules/automation/ipc.ts`: add `openCreateEditorWindow` and `openEditorWindow` IPC methods.
- `desktop/electron/preload.ts`: expose Automation editor window open methods.
- `desktop/src/types/bridge.ts`: type new bridge methods.
- `desktop/src/main.tsx`: route `?window=automation-editor` to `AutomationEditorApp`.
- `desktop/src/modules/automation/index.tsx`: replace card grid/dialog create/edit state with list module and editor open calls.
- `desktop/src/modules/automation/hooks/use-automation.ts`: add helper functions for opening editor windows if desired.
- `desktop/src/modules/automation/types.ts`: replace dialog-specific form state with editor draft state.
- `desktop/src/modules/automation/utils.ts`: use renderer trigger registry for trigger parsing and summary.
- `desktop/src/modules/automation/__tests__/automation-module.test.tsx`: update main page tests.
- `desktop/src/modules/automation/hooks/__tests__/use-automation.test.tsx`: cover editor open helpers if hooks are added.
- `desktop/electron/__tests__/preload.test.ts`: cover new preload methods.
- `desktop/electron/modules/automation/__tests__/ipc.test.ts`: cover new IPC method schemas.
- `desktop/electron/bootstrap/descriptors.ts`: provide the Automation window service if using ServiceRegistry.
- `desktop/electron/bootstrap/__tests__/descriptors.test.ts`: cover descriptor.
- `RELEASE_NOTES_PENDING.md`: user-visible UI correction note.

Do not modify:

- `templates/`.
- Existing Task Scheduler data model or renderer.
- Automation runtime execution semantics except for window-open IPC.

---

### Task 1: Renderer Trigger Registry

**Files:**

- Create: `desktop/src/automation-triggers/action-registry.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/schema.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/manifest.ts`
- Create: `desktop/automation-trigger-packages/builtin/cron/config.renderer.tsx`
- Create: `desktop/automation-trigger-packages/builtin/cron/index.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/schema.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/manifest.ts`
- Create: `desktop/automation-trigger-packages/builtin/interval/config.renderer.tsx`
- Create: `desktop/automation-trigger-packages/builtin/interval/index.ts`
- Create: `desktop/src/automation-triggers/builtin-triggers.ts`
- Test: `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`

- [ ] **Step 1: Write failing registry test**

Create `desktop/src/automation-triggers/__tests__/trigger-registry.test.tsx`:

```tsx
import { describe, expect, it } from "vitest"

import { rendererAutomationTriggerRegistry } from "../builtin-triggers"

describe("rendererAutomationTriggerRegistry", () => {
  it("registers built-in triggers in product order", () => {
    expect(rendererAutomationTriggerRegistry.list().map((trigger) => trigger.manifest.id)).toEqual([
      "builtin.cron",
      "builtin.interval",
    ])
  })

  it("parses and summarizes cron config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.cron", {
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })

    expect(parsed).toEqual({
      expr: "0 9 * * *",
      timezone: "Asia/Shanghai",
      activeDays: [1, 2, 3, 4, 5],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.cron", parsed)).toBe("Cron · 0 9 * * *")
  })

  it("parses and summarizes interval config", () => {
    const parsed = rendererAutomationTriggerRegistry.parseConfig("builtin.interval", {
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })

    expect(parsed).toEqual({
      everyMinutes: 60,
      anchor: "last_completed_at",
      activeDays: [0, 1, 2, 3, 4, 5, 6],
    })
    expect(rendererAutomationTriggerRegistry.summarize("builtin.interval", parsed)).toBe("每 60 分钟 · 完成后")
  })

  it("rejects duplicate trigger ids", () => {
    const existing = rendererAutomationTriggerRegistry.get("builtin.cron")

    expect(() => rendererAutomationTriggerRegistry.register(existing)).toThrow(
      'Automation trigger "builtin.cron" is already registered',
    )
  })
})
```

- [ ] **Step 2: Run registry test to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: FAIL because `desktop/src/automation-triggers/builtin-triggers.ts` does not exist.

- [ ] **Step 3: Implement registry**

Create `desktop/src/automation-triggers/action-registry.ts`:

```ts
import type { ReactElement } from "react"

export type AutomationTriggerConfig = Record<string, unknown>

export type AutomationTriggerConfigFormComponent<TConfig extends AutomationTriggerConfig = AutomationTriggerConfig> = (props: {
  readonly value: TConfig
  readonly onChange: (value: TConfig) => void
}) => ReactElement

export type AutomationTriggerManifest<TConfig extends AutomationTriggerConfig = AutomationTriggerConfig> = {
  readonly id: string
  readonly title: string
  readonly defaultConfig: TConfig
  readonly configSchema: { parse(config: unknown): TConfig }
}

export type RendererAutomationTriggerDefinition<TConfig extends AutomationTriggerConfig = AutomationTriggerConfig> = {
  readonly manifest: AutomationTriggerManifest<TConfig>
  summarizeConfig(config: TConfig): string
  ConfigForm?: AutomationTriggerConfigFormComponent<TConfig>
}

export class RendererAutomationTriggerRegistry {
  private readonly triggers = new Map<string, RendererAutomationTriggerDefinition>()

  register<TConfig extends AutomationTriggerConfig>(trigger: RendererAutomationTriggerDefinition<TConfig>): void {
    const { id } = trigger.manifest
    if (this.triggers.has(id)) {
      throw new Error(`Automation trigger "${id}" is already registered`)
    }
    this.triggers.set(id, trigger as RendererAutomationTriggerDefinition)
  }

  get(id: string): RendererAutomationTriggerDefinition {
    const trigger = this.triggers.get(id)
    if (!trigger) {
      throw new Error(`Automation trigger "${id}" is not registered`)
    }
    return trigger
  }

  list(): readonly RendererAutomationTriggerDefinition[] {
    return [...this.triggers.values()]
  }

  getDefaultConfig(id: string): AutomationTriggerConfig {
    return this.get(id).manifest.defaultConfig
  }

  parseConfig(id: string, config: AutomationTriggerConfig): AutomationTriggerConfig {
    return this.get(id).manifest.configSchema.parse(config)
  }

  summarize(id: string, config: AutomationTriggerConfig): string {
    const trigger = this.get(id)
    return trigger.summarizeConfig(trigger.manifest.configSchema.parse(config))
  }
}
```

- [ ] **Step 4: Implement trigger packages**

Create `desktop/automation-trigger-packages/builtin/cron/schema.ts`:

```ts
import { z } from "zod"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const cronTriggerConfigSchema = z.object({
  expr: z.string().min(1),
  timezone: z.string().min(1).optional(),
  activeDays: activeDaysSchema,
})

export type CronTriggerConfig = z.infer<typeof cronTriggerConfigSchema>
```

Create `desktop/automation-trigger-packages/builtin/cron/manifest.ts`:

```ts
import type { AutomationTriggerManifest } from "../../../src/automation-triggers/action-registry"
import { cronTriggerConfigSchema, type CronTriggerConfig } from "./schema"

export const cronTriggerManifest = {
  id: "builtin.cron",
  title: "Cron",
  defaultConfig: {
    expr: "0 9 * * *",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  configSchema: cronTriggerConfigSchema,
} satisfies AutomationTriggerManifest<CronTriggerConfig>
```

Create `desktop/automation-trigger-packages/builtin/interval/schema.ts`:

```ts
import { z } from "zod"

const activeDaysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)

export const intervalTriggerConfigSchema = z.object({
  everyMinutes: z.number().int().positive(),
  anchor: z.enum(["created_at", "last_completed_at"]),
  activeDays: activeDaysSchema,
})

export type IntervalTriggerConfig = z.infer<typeof intervalTriggerConfigSchema>
```

Create `desktop/automation-trigger-packages/builtin/interval/manifest.ts`:

```ts
import type { AutomationTriggerManifest } from "../../../src/automation-triggers/action-registry"
import { intervalTriggerConfigSchema, type IntervalTriggerConfig } from "./schema"

export const intervalTriggerManifest = {
  id: "builtin.interval",
  title: "固定间隔",
  defaultConfig: {
    everyMinutes: 60,
    anchor: "created_at",
    activeDays: [0, 1, 2, 3, 4, 5, 6],
  },
  configSchema: intervalTriggerConfigSchema,
} satisfies AutomationTriggerManifest<IntervalTriggerConfig>
```

Create `desktop/automation-trigger-packages/builtin/cron/config.renderer.tsx`:

```tsx
import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { CronTriggerConfig } from "./schema"

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

export function CronTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: CronTriggerConfig
  readonly onChange: (value: CronTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="automation-trigger-cron-expr">Cron 表达式</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-cron-expr"
            value={value.expr}
            onChange={(event) => onChange({ ...value, expr: event.target.value })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel htmlFor="automation-trigger-cron-timezone">时区</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-cron-timezone"
            value={value.timezone ?? ""}
            onChange={(event) => onChange({ ...value, timezone: event.target.value || undefined })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>活跃日</FieldLabel>
        <FieldContent>
          <ToggleGroup
            className="w-full"
            type="multiple"
            value={value.activeDays.map(String)}
            variant="outline"
            onValueChange={(days) => {
              const activeDays = days.map(Number).filter((day) => Number.isInteger(day))
              onChange({ ...value, activeDays })
            }}
          >
            {WEEKDAYS.map((day) => (
              <ToggleGroupItem key={day.value} className="flex-1" value={String(day.value)}>
                {day.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
    </div>
  )
}
```

Create `desktop/automation-trigger-packages/builtin/interval/config.renderer.tsx`:

```tsx
import {
  Field,
  FieldContent,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "../../../src/components/ui/toggle-group"
import type { IntervalTriggerConfig } from "./schema"

const WEEKDAYS = [
  { value: 1, label: "一" },
  { value: 2, label: "二" },
  { value: 3, label: "三" },
  { value: 4, label: "四" },
  { value: 5, label: "五" },
  { value: 6, label: "六" },
  { value: 0, label: "日" },
]

export function IntervalTriggerConfigForm({
  value,
  onChange,
}: {
  readonly value: IntervalTriggerConfig
  readonly onChange: (value: IntervalTriggerConfig) => void
}) {
  return (
    <div className="grid gap-4">
      <Field>
        <FieldLabel htmlFor="automation-trigger-interval-minutes">间隔分钟</FieldLabel>
        <FieldContent>
          <Input
            id="automation-trigger-interval-minutes"
            inputMode="numeric"
            value={String(value.everyMinutes)}
            onChange={(event) => onChange({ ...value, everyMinutes: Number(event.target.value) })}
          />
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>起算方式</FieldLabel>
        <FieldContent>
          <ToggleGroup
            className="w-full"
            type="single"
            value={value.anchor}
            variant="outline"
            onValueChange={(anchor) => {
              if (anchor === "created_at" || anchor === "last_completed_at") onChange({ ...value, anchor })
            }}
          >
            <ToggleGroupItem className="flex-1" value="created_at">从创建时间</ToggleGroupItem>
            <ToggleGroupItem className="flex-1" value="last_completed_at">上次完成后</ToggleGroupItem>
          </ToggleGroup>
        </FieldContent>
      </Field>
      <Field>
        <FieldLabel>活跃日</FieldLabel>
        <FieldContent>
          <ToggleGroup
            className="w-full"
            type="multiple"
            value={value.activeDays.map(String)}
            variant="outline"
            onValueChange={(days) => {
              const activeDays = days.map(Number).filter((day) => Number.isInteger(day))
              onChange({ ...value, activeDays })
            }}
          >
            {WEEKDAYS.map((day) => (
              <ToggleGroupItem key={day.value} className="flex-1" value={String(day.value)}>
                {day.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldContent>
      </Field>
    </div>
  )
}
```

- [ ] **Step 5: Register built-in triggers**

Create `desktop/automation-trigger-packages/builtin/cron/index.ts`:

```ts
export { CronTriggerConfigForm } from "./config.renderer"
export { cronTriggerManifest } from "./manifest"
export { cronTriggerConfigSchema, type CronTriggerConfig } from "./schema"
```

Create `desktop/automation-trigger-packages/builtin/interval/index.ts`:

```ts
export { IntervalTriggerConfigForm } from "./config.renderer"
export { intervalTriggerManifest } from "./manifest"
export { intervalTriggerConfigSchema, type IntervalTriggerConfig } from "./schema"
```

Create `desktop/src/automation-triggers/builtin-triggers.ts`:

```ts
import { cronTriggerManifest, type CronTriggerConfig } from "../../automation-trigger-packages/builtin/cron"
import { CronTriggerConfigForm } from "../../automation-trigger-packages/builtin/cron/config.renderer"
import { intervalTriggerManifest, type IntervalTriggerConfig } from "../../automation-trigger-packages/builtin/interval"
import { IntervalTriggerConfigForm } from "../../automation-trigger-packages/builtin/interval/config.renderer"
import {
  RendererAutomationTriggerRegistry,
  type RendererAutomationTriggerDefinition,
} from "./action-registry"

const cronRendererTrigger: RendererAutomationTriggerDefinition<CronTriggerConfig> = {
  manifest: cronTriggerManifest,
  summarizeConfig: (config) => `Cron · ${config.expr}`,
  ConfigForm: CronTriggerConfigForm,
}

const intervalRendererTrigger: RendererAutomationTriggerDefinition<IntervalTriggerConfig> = {
  manifest: intervalTriggerManifest,
  summarizeConfig: (config) => config.anchor === "last_completed_at"
    ? `每 ${config.everyMinutes} 分钟 · 完成后`
    : `每 ${config.everyMinutes} 分钟`,
  ConfigForm: IntervalTriggerConfigForm,
}

export const rendererAutomationTriggerRegistry = new RendererAutomationTriggerRegistry()
rendererAutomationTriggerRegistry.register(cronRendererTrigger)
rendererAutomationTriggerRegistry.register(intervalRendererTrigger)
```

- [ ] **Step 6: Run registry test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/automation-triggers desktop/automation-trigger-packages
git commit -m "feat: add automation trigger renderer registry"
```

---

### Task 2: Automation Editor Window Bridge

**Files:**

- Create: `desktop/electron/services/automation-window-service.ts`
- Create: `desktop/electron/services/__tests__/automation-window-service.test.ts`
- Create: `desktop/electron/modules/shared/renderer-base-url.ts`
- Modify: `desktop/electron/modules/automation/ipc.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/__tests__/preload.test.ts`
- Modify: `desktop/electron/modules/automation/__tests__/ipc.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/automation-window-service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

import { createAutomationWindowService } from "../automation-window-service"

function createWindowMock() {
  return {
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    restore: vi.fn(),
    focus: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    on: vi.fn(),
    webContents: { id: Math.floor(Math.random() * 10000) },
  }
}

describe("createAutomationWindowService", () => {
  it("reuses the create draft window", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openCreate()
    await service.openCreate()

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("reuses the same edit window by automation id", async () => {
    const window = createWindowMock()
    const createWindow = vi.fn(() => window as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openEdit("automation-1")
    await service.openEdit("automation-1")

    expect(createWindow).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it("opens different edit windows for different automation ids", async () => {
    const createWindow = vi.fn(() => createWindowMock() as never)
    const service = createAutomationWindowService({ createWindow, baseUrl: () => "app://-" })

    await service.openEdit("automation-1")
    await service.openEdit("automation-2")

    expect(createWindow).toHaveBeenCalledTimes(2)
  })
})
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/automation-window-service.test.ts
```

Expected: FAIL because `automation-window-service.ts` does not exist.

- [ ] **Step 3: Implement window service**

Create `desktop/electron/modules/shared/renderer-base-url.ts`:

```ts
import { app } from "electron"
import path from "node:path"
import { pathToFileURL } from "node:url"

export function rendererBaseUrl(): string {
  return process.env.VITE_DEV_SERVER_URL
    ?? pathToFileURL(path.join(app.getAppPath(), "dist/index.html")).toString()
}
```

In `desktop/electron/modules/workflow/ipc.ts`, remove its local `rendererBaseUrl` function and import the shared helper:

```ts
import { rendererBaseUrl } from "../shared/renderer-base-url"
```

Create `desktop/electron/services/automation-window-service.ts`:

```ts
import { BrowserWindow } from "electron"
import { rendererBaseUrl } from "../modules/shared/renderer-base-url"

type AutomationWindowServiceDeps = {
  readonly createWindow: (options: Electron.BrowserWindowConstructorOptions) => BrowserWindow
  readonly baseUrl: () => string
}

const AUTOMATION_EDITOR_WINDOW_BOUNDS = {
  width: 1180,
  height: 820,
  minWidth: 960,
  minHeight: 640,
}

export function createAutomationWindowService(deps: AutomationWindowServiceDeps) {
  let createWindow: BrowserWindow | null = null
  const editWindows = new Map<string, BrowserWindow>()

  function focusWindow(window: BrowserWindow): void {
    if (window.isMinimized()) window.restore()
    window.focus()
  }

  async function openWindow(key: string, params: URLSearchParams): Promise<BrowserWindow> {
    const existing = key === "create" ? createWindow : editWindows.get(key)
    if (existing && !existing.isDestroyed()) {
      focusWindow(existing)
      return existing
    }

    const window = deps.createWindow({
      ...AUTOMATION_EDITOR_WINDOW_BOUNDS,
      title: "Automation Editor",
      webPreferences: {
        preload: require.resolve("../preload"),
        contextIsolation: true,
        sandbox: false,
      },
    })
    const url = `${deps.baseUrl()}${deps.baseUrl().includes("?") ? "&" : "?"}${params.toString()}`

    if (key === "create") {
      createWindow = window
    } else {
      editWindows.set(key, window)
    }

    window.on("closed", () => {
      if (key === "create") {
        createWindow = null
      } else {
        editWindows.delete(key)
      }
    })

    try {
      await window.loadURL(url)
    } catch (error) {
      if (key === "create") {
        createWindow = null
      } else {
        editWindows.delete(key)
      }
      if (!window.isDestroyed()) window.destroy()
      throw error
    }

    return window
  }

  return {
    openCreate(): Promise<BrowserWindow> {
      return openWindow("create", new URLSearchParams({ window: "automation-editor", mode: "create" }))
    },
    openEdit(automationId: string): Promise<BrowserWindow> {
      return openWindow(automationId, new URLSearchParams({ window: "automation-editor", mode: "edit", automationId }))
    },
  }
}

export const automationWindowService = createAutomationWindowService({
  createWindow: (options) => new BrowserWindow(options),
  baseUrl: rendererBaseUrl,
})
```

- [ ] **Step 4: Add IPC methods**

In `desktop/electron/modules/automation/ipc.ts`, import `automationWindowService` and add methods:

```ts
openCreateEditorWindow: {
  channel: "synapse:automation:editor:open-create",
  kind: "invoke",
  request: z.void().optional(),
  response: z.void(),
  handler: async () => {
    await automationWindowService.openCreate()
  },
},
openEditorWindow: {
  channel: "synapse:automation:editor:open-edit",
  kind: "invoke",
  request: automationIdRequestSchema,
  response: z.void(),
  handler: async (_ctx, request: AutomationIdRequest) => {
    await automationWindowService.openEdit(request.automationId)
  },
},
```

- [ ] **Step 5: Expose preload bridge methods**

In `desktop/electron/preload.ts`, add channels:

```ts
"openCreateEditorWindow": "synapse:automation:editor:open-create",
"openEditorWindow": "synapse:automation:editor:open-edit",
```

In the `automation` bridge object, add:

```ts
openCreateEditorWindow: () => invoke(IPC_CHANNELS.automation.openCreateEditorWindow)(),
openEditorWindow: (id) => invoke(IPC_CHANNELS.automation.openEditorWindow)({ automationId: id }),
```

In `desktop/src/types/bridge.ts`, add:

```ts
openCreateEditorWindow: () => Promise<void>
openEditorWindow: (id: string) => Promise<void>
```

- [ ] **Step 6: Run focused bridge tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/automation-window-service.test.ts electron/modules/automation/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/automation-window-service.ts desktop/electron/services/__tests__/automation-window-service.test.ts desktop/electron/modules/automation/ipc.ts desktop/electron/preload.ts desktop/src/types/bridge.ts desktop/electron/__tests__/preload.test.ts desktop/electron/modules/automation/__tests__/ipc.test.ts
git commit -m "feat: add automation editor window bridge"
```

---

### Task 3: Automation Editor Renderer

**Files:**

- Create: `desktop/src/modules/automation/editor/editor-app.tsx`
- Create: `desktop/src/modules/automation/editor/editor-form.tsx`
- Create: `desktop/src/modules/automation/editor/trigger-executor-builder.tsx`
- Create: `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
- Modify: `desktop/src/main.tsx`
- Modify: `desktop/src/modules/automation/types.ts`
- Modify: `desktop/src/modules/automation/utils.ts`

- [ ] **Step 1: Write failing editor tests**

Create `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`:

```tsx
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AutomationEditorApp } from "../editor-app"

const createItem = vi.fn()
const updateItem = vi.fn()
const getItem = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({
    getItem,
    createItem,
    updateItem,
  }),
}))

describe("AutomationEditorApp", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
    window.history.replaceState(null, "", "/")
  })

  it("shows trigger and executor lists in create mode", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("当以下情况发生时")
    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).toContain("固定间隔")
    expect(document.body.textContent).toContain("就执行以下操作")
    expect(document.body.textContent).toContain("命令")
    expect(document.body.textContent).toContain("Agent")
  })

  it("switches selected trigger back to list with reselect", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("Cron"))?.click()
    })

    expect(document.body.textContent).toContain("Cron 表达式")

    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "重新选择")?.click()
    })

    expect(document.body.textContent).toContain("固定间隔")
  })
})
```

- [ ] **Step 2: Run editor tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: FAIL because the editor app does not exist.

- [ ] **Step 3: Define editor draft types**

In `desktop/src/modules/automation/types.ts`, replace dialog-specific state with:

```ts
import type { AutomationItem } from "@/types/automation"
import type { ActionConfig } from "../../../action-packages/types"

export type AutomationEditorMode =
  | { mode: "create" }
  | { mode: "edit"; automationId: string }

export type AutomationEditorDraft = {
  name: string
  description: string
  cwd: string
  enabled: boolean
  triggerType: string | null
  triggerConfig: Record<string, unknown>
  executorType: string | null
  executorConfig: ActionConfig
  missedRunPolicy: "skip" | "run_once"
}

export type AutomationEditorLoadState =
  | { status: "loading" }
  | { status: "ready"; draft: AutomationEditorDraft; item?: AutomationItem }
  | { status: "error"; message: string }
```

- [ ] **Step 4: Update utilities**

In `desktop/src/modules/automation/utils.ts`, keep existing format helpers and replace form-building helpers with editor-draft helpers:

```ts
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"

function createDefaultAutomationDraft(): AutomationEditorDraft {
  return {
    name: "",
    description: "",
    cwd: "",
    enabled: false,
    triggerType: null,
    triggerConfig: {},
    executorType: null,
    executorConfig: {},
    missedRunPolicy: "skip",
  }
}

function createAutomationDraftFromItem(item: AutomationItem): AutomationEditorDraft {
  return {
    name: item.name,
    description: item.description ?? "",
    cwd: item.cwd ?? "",
    enabled: item.enabled,
    triggerType: item.trigger.type,
    triggerConfig: item.trigger.config,
    executorType: item.executor.type,
    executorConfig: item.executor.config,
    missedRunPolicy: item.policy.missedRunPolicy,
  }
}

function buildAutomationCreateInputFromDraft(draft: AutomationEditorDraft, enabled: boolean): AutomationCreateInput {
  return buildAutomationPayloadFromDraft(draft, enabled)
}

function buildAutomationUpdateInputFromDraft(draft: AutomationEditorDraft, enabled: boolean): AutomationUpdateInput {
  return buildAutomationPayloadFromDraft(draft, enabled)
}

function buildAutomationPayloadFromDraft(draft: AutomationEditorDraft, enabled: boolean): AutomationCreateInput {
  const name = requireTrimmed(draft.name, "名称")
  if (!draft.triggerType) throw new Error("请选择触发器")
  if (!draft.executorType) throw new Error("请选择执行器")
  const triggerConfig = rendererAutomationTriggerRegistry.parseConfig(draft.triggerType, draft.triggerConfig)
  const executorConfig = rendererActionRegistry.parseConfig(draft.executorType, draft.executorConfig)
  const projectId = (executorConfig as Record<string, unknown>).projectId
  const scope = typeof projectId === "string" && projectId.trim()
    ? { type: "project" as const, projectId: projectId.trim() }
    : { type: "global" as const }

  return {
    name,
    description: optionalTrimmed(draft.description),
    enabled,
    scope,
    cwd: optionalTrimmed(draft.cwd),
    trigger: { type: draft.triggerType, config: triggerConfig },
    executor: { type: draft.executorType, config: executorConfig },
    policy: { missedRunPolicy: draft.missedRunPolicy, overlapPolicy: "skip" },
  }
}
```

Also update `formatAutomationTrigger` to call `rendererAutomationTriggerRegistry.summarize(...)` with a try/catch matching the existing executor summary error handling.

- [ ] **Step 5: Implement builder component**

Create `desktop/src/modules/automation/editor/trigger-executor-builder.tsx`:

```tsx
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { rendererAutomationTriggerRegistry } from "@/automation-triggers/builtin-triggers"
import { Button } from "@/components/ui/button"
import type { ActionConfig } from "../../../../action-packages/types"

type BuilderProps = {
  triggerType: string | null
  triggerConfig: Record<string, unknown>
  executorType: string | null
  executorConfig: ActionConfig
  onTriggerChange: (type: string | null, config: Record<string, unknown>) => void
  onExecutorChange: (type: string | null, config: ActionConfig) => void
}

export function TriggerExecutorBuilder(props: BuilderProps) {
  const selectedTrigger = props.triggerType ? rendererAutomationTriggerRegistry.get(props.triggerType) : null
  const selectedExecutor = props.executorType ? rendererActionRegistry.get(props.executorType) : null
  const TriggerConfigForm = selectedTrigger?.ConfigForm
  const ExecutorConfigForm = selectedExecutor?.ConfigForm

  return (
    <div className="grid min-h-[500px] grid-cols-1 gap-8 py-7 md:grid-cols-2">
      <section className="min-w-0">
        <BuilderHeader title="当以下情况发生时" detail={selectedTrigger ? "配置触发器" : "选择触发器"} />
        {selectedTrigger ? (
          <div className="grid gap-5">
            <SelectedHeader
              title={selectedTrigger.manifest.title}
              summary={selectedTrigger.summarizeConfig(selectedTrigger.manifest.configSchema.parse(props.triggerConfig))}
              onClear={() => props.onTriggerChange(null, {})}
            />
            {TriggerConfigForm ? (
              <TriggerConfigForm value={selectedTrigger.manifest.configSchema.parse(props.triggerConfig)} onChange={(config) => props.onTriggerChange(selectedTrigger.manifest.id, config)} />
            ) : null}
          </div>
        ) : (
          <ChoiceList
            items={rendererAutomationTriggerRegistry.list().map((trigger) => ({
              id: trigger.manifest.id,
              title: trigger.manifest.title,
              summary: trigger.summarizeConfig(trigger.manifest.defaultConfig),
            }))}
            onSelect={(id) => props.onTriggerChange(id, { ...rendererAutomationTriggerRegistry.getDefaultConfig(id) })}
          />
        )}
      </section>
      <section className="min-w-0 border-t border-border pt-7 md:border-l md:border-t-0 md:pl-8 md:pt-0">
        <BuilderHeader title="就执行以下操作" detail={selectedExecutor ? "配置执行器" : "选择执行器"} />
        {selectedExecutor ? (
          <div className="grid gap-5">
            <SelectedHeader
              title={selectedExecutor.manifest.title}
              summary={selectedExecutor.summarizeConfig(selectedExecutor.manifest.configSchema.parse(props.executorConfig))}
              onClear={() => props.onExecutorChange(null, {})}
            />
            {ExecutorConfigForm ? (
              <ExecutorConfigForm value={selectedExecutor.manifest.configSchema.parse(props.executorConfig)} onChange={(config) => props.onExecutorChange(selectedExecutor.manifest.id, config)} />
            ) : null}
          </div>
        ) : (
          <ChoiceList
            items={rendererActionRegistry.list().map((executor) => ({
              id: executor.manifest.id,
              title: executor.manifest.title,
              summary: executor.summarizeConfig(executor.manifest.defaultConfig),
            }))}
            onSelect={(id) => props.onExecutorChange(id, { ...rendererActionRegistry.getDefaultConfig(id) })}
          />
        )}
      </section>
    </div>
  )
}

function BuilderHeader({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
    </div>
  )
}

function SelectedHeader({ title, summary, onClear }: { title: string; summary: string; onClear: () => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 truncate text-xs text-muted-foreground">{summary}</p>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        重新选择
      </Button>
    </div>
  )
}

function ChoiceList({ items, onSelect }: { items: Array<{ id: string; title: string; summary: string }>; onSelect: (id: string) => void }) {
  return (
    <div className="grid gap-1">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex min-h-16 w-full items-center justify-between gap-4 rounded-lg bg-transparent px-2 py-3 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => onSelect(item.id)}
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold">{item.title}</span>
            <span className="mt-1 block truncate text-xs text-muted-foreground">{item.summary}</span>
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">选择</span>
        </button>
      ))}
    </div>
  )
}
```

- [ ] **Step 6: Implement editor app and form**

Create `desktop/src/modules/automation/editor/editor-app.tsx` and `editor-form.tsx` with:

- Query parsing from `window.location.search`.
- `mode=create` initializes `createDefaultAutomationDraft()`.
- `mode=edit&automationId=<id>` loads `requireBridgeDomain("automation").getItem(id)`.
- Title input at top.
- `TriggerExecutorBuilder` in the body.
- Footer buttons `仅保存` and `保存并启用`.
- `仅保存` calls create/update with `enabled` preserved for edit and `false` for create.
- `保存并启用` calls create/update with `enabled: true`.

The root JSX shape must use only theme tokens and layout utilities. Use this component structure:

```tsx
<div className="flex h-screen flex-col bg-background">
  <div className="border-b border-border px-8 py-6">
    <Input
      className="h-11 max-w-md text-lg font-semibold"
      value={draft.name}
      onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
    />
  </div>
  <div className="min-h-0 flex-1 overflow-auto px-8">
    <TriggerExecutorBuilder
      triggerType={draft.triggerType}
      triggerConfig={draft.triggerConfig}
      executorType={draft.executorType}
      executorConfig={draft.executorConfig}
      onTriggerChange={(triggerType, triggerConfig) => setDraft((current) => ({ ...current, triggerType, triggerConfig }))}
      onExecutorChange={(executorType, executorConfig) => setDraft((current) => ({ ...current, executorType, executorConfig }))}
    />
  </div>
  <div className="flex justify-end gap-2 border-t border-border px-8 py-4">
    <Button variant="outline">仅保存</Button>
    <Button>保存并启用</Button>
  </div>
</div>
```

- [ ] **Step 7: Register renderer route**

In `desktop/src/main.tsx`, add before the `tool` branch:

```tsx
} else if (windowType === "automation-editor") {
  const { AutomationEditorApp } = await import("@/modules/automation/editor/editor-app")
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <AppErrorBoundary>
        <AppConfigProvider>
          <AppNotificationsProvider>
            <AutomationEditorApp />
          </AppNotificationsProvider>
        </AppConfigProvider>
      </AppErrorBoundary>
    </StrictMode>,
  )
```

- [ ] **Step 8: Run editor tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation/editor/__tests__/editor-app.test.tsx src/automation-triggers/__tests__/trigger-registry.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/main.tsx desktop/src/modules/automation/editor desktop/src/modules/automation/types.ts desktop/src/modules/automation/utils.ts
git commit -m "feat: add automation editor window UI"
```

---

### Task 4: Replace Automation Main Page List

**Files:**

- Create: `desktop/src/modules/automation/components/automation-list.tsx`
- Create: `desktop/src/modules/automation/components/automation-list-row.tsx`
- Modify: `desktop/src/modules/automation/index.tsx`
- Modify: `desktop/src/modules/automation/__tests__/automation-module.test.tsx`

- [ ] **Step 1: Write failing page tests**

Update `desktop/src/modules/automation/__tests__/automation-module.test.tsx` to assert:

```tsx
it("opens the create editor window from the new button", async () => {
  const openCreateEditorWindow = vi.fn().mockResolvedValue(undefined)
  installAutomationBridge({ listItems: vi.fn().mockResolvedValue([]), openCreateEditorWindow })

  render(<AutomationModule />)
  await userEvent.click(await screen.findByRole("button", { name: "新建" }))

  expect(openCreateEditorWindow).toHaveBeenCalledTimes(1)
})

it("opens the edit editor window from the row body", async () => {
  const openEditorWindow = vi.fn().mockResolvedValue(undefined)
  installAutomationBridge({
    listItems: vi.fn().mockResolvedValue([automationItem({ id: "automation-1", name: "每天同步日报" })]),
    openEditorWindow,
  })

  render(<AutomationModule />)
  await userEvent.click(await screen.findByRole("button", { name: /每天同步日报/ }))

  expect(openEditorWindow).toHaveBeenCalledWith("automation-1")
})
```

- [ ] **Step 2: Run page tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation/__tests__/automation-module.test.tsx
```

Expected: FAIL because current page opens the form dialog.

- [ ] **Step 3: Implement list row**

Create `desktop/src/modules/automation/components/automation-list-row.tsx`:

```tsx
import { History, Play, Square, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item"
import type { AutomationItem } from "@/types/automation"
import { formatAutomationExecutor, formatAutomationTrigger } from "../utils"

type AutomationListRowProps = {
  item: AutomationItem
  busy: boolean
  onOpen: () => void
  onRun: () => void
  onStop: () => void
  onHistory: () => void
  onDelete: () => void
}

export function AutomationListRow({ item, busy, onOpen, onRun, onStop, onHistory, onDelete }: AutomationListRowProps) {
  const activeRunning = item.activeRun?.status === "running"

  return (
    <Item
      size="sm"
      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_10rem_10rem_auto] items-center gap-3 bg-card"
      tabIndex={0}
      role="button"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onOpen()
        }
      }}
    >
      <ItemContent className="min-w-0 flex-row items-center gap-2">
        <ItemTitle className="w-full min-w-0">
          <span className="min-w-0 truncate">{item.name}</span>
        </ItemTitle>
      </ItemContent>
      <span className="truncate text-right text-sm text-muted-foreground">{formatAutomationTrigger(item)}</span>
      <span className="truncate text-sm text-muted-foreground">{formatAutomationExecutor(item)}</span>
      <ItemActions className="w-28 justify-end gap-1">
        {activeRunning ? (
          <Button type="button" size="icon-sm" variant="ghost" disabled={busy} aria-label="停止自动化" onClick={(event) => { event.stopPropagation(); onStop() }}>
            <Square />
          </Button>
        ) : (
          <Button type="button" size="icon-sm" variant="ghost" disabled={busy || !item.enabled} aria-label="运行自动化" onClick={(event) => { event.stopPropagation(); onRun() }}>
            <Play />
          </Button>
        )}
        <Button type="button" size="icon-sm" variant="ghost" aria-label="查看运行历史" onClick={(event) => { event.stopPropagation(); onHistory() }}>
          <History />
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" disabled={busy || activeRunning} aria-label="删除自动化" onClick={(event) => { event.stopPropagation(); onDelete() }}>
          <Trash2 />
        </Button>
      </ItemActions>
    </Item>
  )
}
```

- [ ] **Step 4: Implement list container**

Create `desktop/src/modules/automation/components/automation-list.tsx`:

```tsx
import { AlertCircle, Loader2, Plus, RefreshCw } from "lucide-react"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import type { AutomationItem } from "@/types/automation"
import { AutomationListRow } from "./automation-list-row"

type AutomationListProps = {
  items: AutomationItem[]
  loading: boolean
  error: string | null
  busy: boolean
  onRefresh: () => void
  onCreate: () => void
  onOpen: (item: AutomationItem) => void
  onRun: (item: AutomationItem) => void
  onStop: (item: AutomationItem) => void
  onHistory: (item: AutomationItem) => void
  onDelete: (item: AutomationItem) => void
}

export function AutomationList({
  items,
  loading,
  error,
  busy,
  onRefresh,
  onCreate,
  onOpen,
  onRun,
  onStop,
  onHistory,
  onDelete,
}: AutomationListProps) {
  if (loading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <Loader2 className="size-10 animate-spin text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">加载中…</p>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3 p-4">
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertDescription className="text-xs">{error}</AlertDescription>
        </Alert>
        <Button size="sm" variant="outline" onClick={onRefresh}>
          <RefreshCw data-icon="inline-start" />重试
        </Button>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <p className="text-sm text-muted-foreground">还没有自动化</p>
            <Button size="sm" variant="outline" onClick={onCreate}>
              <Plus data-icon="inline-start" />创建第一个自动化
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-2">
      {items.map((item) => (
        <AutomationListRow
          key={item.id}
          item={item}
          busy={busy}
          onOpen={() => onOpen(item)}
          onRun={() => onRun(item)}
          onStop={() => onStop(item)}
          onHistory={() => onHistory(item)}
          onDelete={() => onDelete(item)}
        />
      ))}
    </div>
  )
}
```

- [ ] **Step 5: Replace main page**

In `desktop/src/modules/automation/index.tsx`:

- Remove `AutomationCardGrid`.
- Remove `AutomationFormDialog`.
- Remove `formState` and `isFormOpen`.
- Header becomes Workflow-style:

```tsx
<div className="flex h-full min-h-0 flex-col bg-surface">
  <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 px-2 py-2.5">
    <h2 className="text-sm font-semibold">自动化</h2>
    <Button size="sm" variant="outline" disabled={busy} onClick={() => { void openAutomationCreateEditor() }}>
      <Plus className="h-4 w-4 mr-1.5" />新建
    </Button>
  </div>
  <ScrollArea className="min-h-0 flex-1">
    <div className="min-h-full px-2 pb-2 pt-0">
      <AutomationList
        items={items}
        loading={loading}
        error={error}
        busy={busy}
        onRefresh={() => { void refresh() }}
        onCreate={() => { void openCreateEditorWindow() }}
        onOpen={(item) => { void openEditorWindow(item.id) }}
        onRun={(item) => { void handleRun(item) }}
        onStop={(item) => { void handleStop(item) }}
        onHistory={setHistoryItem}
        onDelete={setDeleteTarget}
      />
    </div>
  </ScrollArea>
</div>
```

- [ ] **Step 6: Run page tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/automation
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/modules/automation
git commit -m "feat: redesign automation list"
```

---

### Task 5: Release Notes And Regression

**Files:**

- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Update release notes**

Add a user-facing note:

```md
- 调整“自动化”页面：列表改为与工作流一致的轻量行布局，新建和编辑改为独立编辑窗口，并支持在左右两列中选择触发器和执行器后再配置。
```

- [ ] **Step 2: Run focused regression tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/automation-triggers src/modules/automation electron/services/__tests__/automation-window-service.test.ts electron/modules/automation/__tests__/ipc.test.ts electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run typecheck or desktop test suite**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS. If the full suite is too slow, run the focused tests plus `pnpm --filter @synapse/desktop run typecheck` and record the reason.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note automation editor redesign"
```

---

## Self-Review

- Spec coverage: The plan covers Workflow-style list, dedicated editor window, window reuse, save semantics, trigger registry, executor reuse, reselect behavior, lightweight UI rules, tests, and release notes.
- Placeholder scan: No `TBD`, `TODO`, or deferred implementation language is left in the task steps.
- Type consistency: The plan consistently uses `AutomationEditorDraft`, `rendererAutomationTriggerRegistry`, `openCreateEditorWindow`, `openEditorWindow`, `TriggerExecutorBuilder`, and existing `rendererActionRegistry`.
