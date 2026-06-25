# Quick Input App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert prompt snippets into the standalone `快捷输入` system app backed by DataRepository app namespaces, migrate existing snippets, and make Agent quick input selection always send immediately.

**Architecture:** Add a `quick-input` app capability package with shared schemas, a main-process service, IPC, and renderer UI. Persist items in `app.quick-input.items` and migration/seed metadata in `app.quick-input.settings`; Agent and the app UI call the service through `window.synapse.quickInput`. Keep the old `config.global.quickInputs` shape only as legacy migration input.

**Tech Stack:** Electron 41, React 19, TypeScript 6, shadcn/Radix UI, lucide-react, Zod, DataRepository JSON/SQLite namespaces, Vitest.

---

## File Structure

- Create `desktop/electron/runtime/data-repo/schemas/quick-input.ts`: DataRepository namespace schemas for `app.quick-input.items` and `app.quick-input.settings`.
- Modify `desktop/electron/runtime/data-repo/schemas/index.ts`: export/register quick input schemas.
- Modify `desktop/electron/runtime/data-repo/factory.ts`: add SQLite indexes for quick input ordering.
- Modify `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`: schema registration, backend, validation tests.
- Create `desktop/app-capabilities/quick-input/shared/schema.ts`: renderer/main/IPC Zod schemas and public item types.
- Create `desktop/app-capabilities/quick-input/shared/defaults.ts`: default quick input content, no `directSend`.
- Create `desktop/app-capabilities/quick-input/shared/capability.ts`: app id and bridge constants.
- Create `desktop/app-capabilities/quick-input/main/service.ts`: core CRUD, ordering, seeding, config migration, change events.
- Create `desktop/app-capabilities/quick-input/main/__tests__/service.test.ts`: service behavior and migration tests.
- Create `desktop/app-capabilities/quick-input/main/ipc.ts`: IPC methods and changed event.
- Create `desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts`: IPC channels and handler tests.
- Modify `desktop/electron/bootstrap/descriptors.ts`: register `core.quick-input`.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`: register `quickInputIpcModule`.
- Modify `desktop/electron/preload.ts`: expose `window.synapse.quickInput`.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`: add quick input channels.
- Modify `desktop/src/types/bridge.ts`: add quick input bridge domain.
- Create `desktop/src/types/quick-input.ts`: renderer-facing quick input item types.
- Create `desktop/app-capabilities/quick-input/renderer/app-definition.ts`, `app-manifest.ts`, `index.tsx`, `assets/icon.svg`, and `__tests__/quick-input-module.test.tsx`: standalone app UI.
- Modify `desktop/src/modules/apps/types.ts`, `registry.ts`, and `components/system-app-content.tsx`: add `quick-input` app and module.
- Modify `desktop/src/modules/apps/dock.ts` tests if needed: verify `quick-input` is not in default Dock.
- Modify `desktop/src/modules/settings/data.ts`, `desktop/src/modules/settings/index.tsx`, `desktop/src/modules/settings/types.ts`, and settings tests: remove Settings quick-input category/panel.
- Modify `desktop/src/constants/defaults.ts`, `desktop/src/lib/config.ts`, and config tests: stop seeding default snippets into config while preserving legacy config field validation.
- Modify `desktop/src/modules/agent/index.tsx`, `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`, `agent-conversation-workspace.tsx`, `agent-composer.tsx`, `quick-input-menu.tsx`, `slash-menu.ts`, and Agent tests: read from new bridge and send immediately.
- Modify `desktop/electron/services/config-backup-service.ts`, `desktop/src/types/backup.ts`, and backup tests: include quick input DataRepository payload while accepting legacy config quick inputs.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note.

---

### Task 1: DataRepository Schemas

**Files:**
- Create: `desktop/electron/runtime/data-repo/schemas/quick-input.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/factory.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`

- [ ] **Step 1: Write failing schema tests**

Add imports in `desktop/electron/runtime/data-repo/__tests__/schemas.test.ts`:

```ts
import {
  quickInputItemsSchema,
  quickInputSettingsSchema,
} from "../schemas/quick-input"
```

Extend the `allSchemas exposes runtime namespaces` expected array with:

```ts
"app.quick-input.items",
"app.quick-input.settings",
```

Extend the backend test with:

```ts
expect(quickInputItemsSchema.backend).toBe("sqlite")
expect(quickInputSettingsSchema.backend).toBe("json")
```

Extend the minimal valid record test with:

```ts
expect(
  quickInputItemsSchema.validate({
    id: "quick-1",
    schemaVersion: 1,
    content: "给个结论",
    sortOrder: 10,
    createdAt: "2026-06-25T00:00:00.000Z",
    updatedAt: "2026-06-25T00:00:00.000Z",
  }),
).toBe(true)
expect(
  quickInputSettingsSchema.validate({
    schemaVersion: 1,
    legacyConfigMigratedAt: null,
    defaultSeededVersion: null,
  }),
).toBe(true)
expect(quickInputItemsSchema.validate({ id: "bad", schemaVersion: 1, content: "", sortOrder: 0 })).toBe(false)
expect(quickInputSettingsSchema.validate({ schemaVersion: 1 })).toBe(false)
```

- [ ] **Step 2: Run schema tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: FAIL because `../schemas/quick-input` does not exist and quick input schemas are not registered.

- [ ] **Step 3: Add quick input DataRepository schema**

Create `desktop/electron/runtime/data-repo/schemas/quick-input.ts`:

```ts
import type { Migration, NamespaceSchema } from "../types"

export interface QuickInputItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  content: string
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export interface QuickInputSettingsEntryV1 extends Record<string, unknown> {
  schemaVersion: 1
  legacyConfigMigratedAt: string | null
  defaultSeededVersion: string | null
}

const noMigrations: readonly Migration[] = []

export const quickInputItemsSchema: NamespaceSchema<QuickInputItemEntryV1> = {
  name: "app.quick-input.items",
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isQuickInputItemEntryV1,
  encrypted: false,
}

export const quickInputSettingsSchema: NamespaceSchema<QuickInputSettingsEntryV1> = {
  name: "app.quick-input.settings",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isQuickInputSettingsEntryV1,
  encrypted: false,
  defaults: () => ({
    schemaVersion: 1,
    legacyConfigMigratedAt: null,
    defaultSeededVersion: null,
  }),
}

function isQuickInputItemEntryV1(value: unknown): value is QuickInputItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.content === "string"
    && value.content.trim().length > 0
    && typeof value.sortOrder === "number"
    && Number.isFinite(value.sortOrder)
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isQuickInputSettingsEntryV1(value: unknown): value is QuickInputSettingsEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && isNullableIsoDateString(value.legacyConfigMigratedAt)
    && (value.defaultSeededVersion === null || typeof value.defaultSeededVersion === "string")
}

function isNullableIsoDateString(value: unknown): value is string | null {
  return value === null || isIsoDateString(value)
}

function isIsoDateString(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && !Number.isNaN(Date.parse(value))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
```

- [ ] **Step 4: Register schemas**

In `desktop/electron/runtime/data-repo/schemas/index.ts`, add exports:

```ts
export {
  quickInputItemsSchema,
  quickInputSettingsSchema,
  type QuickInputItemEntryV1,
  type QuickInputSettingsEntryV1,
} from "./quick-input"
```

Add imports near other schema imports:

```ts
import {
  quickInputItemsSchema,
  quickInputSettingsSchema,
} from "./quick-input"
```

Add both schemas to `allSchemas` after `cheatCodeStatesSchema`:

```ts
quickInputItemsSchema,
quickInputSettingsSchema,
```

- [ ] **Step 5: Add SQLite ordering index**

In `desktop/electron/runtime/data-repo/factory.ts`, add a case in `sqliteIndexesFor`:

```ts
case "app.quick-input.items":
  return ["json_extract(value, '$.sortOrder'), id"]
```

- [ ] **Step 6: Run schema tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit schema task**

```bash
git add desktop/electron/runtime/data-repo/schemas/quick-input.ts \
  desktop/electron/runtime/data-repo/schemas/index.ts \
  desktop/electron/runtime/data-repo/factory.ts \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts
git commit -m "feat(quick-input): add data repository schemas"
```

---

### Task 2: Shared Types, Defaults, And Service

**Files:**
- Create: `desktop/app-capabilities/quick-input/shared/schema.ts`
- Create: `desktop/app-capabilities/quick-input/shared/defaults.ts`
- Create: `desktop/app-capabilities/quick-input/shared/capability.ts`
- Create: `desktop/app-capabilities/quick-input/main/service.ts`
- Test: `desktop/app-capabilities/quick-input/main/__tests__/service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/app-capabilities/quick-input/main/__tests__/service.test.ts`:

```ts
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { QuickInputItemEntryV1, QuickInputSettingsEntryV1 } from "../../../../electron/runtime/data-repo/schemas/quick-input"
import type { SynapseConfig, SynapseConfigPatch } from "../../../../src/types/config"
import { DEFAULT_AGENT_GLOBAL_CONFIG, DEFAULT_GLOBAL_CONFIG } from "../../../../src/constants/defaults"
import { createQuickInputService } from "../service"

describe("QuickInputService", () => {
  it("creates, updates, pins, deletes, and lists items by sortOrder", async () => {
    const harness = createHarness()
    const service = createQuickInputService(harness.deps)

    const created = await service.create({ content: "第二条" })
    const first = await service.create({ content: "第一条" })
    await service.pinToTop({ id: first.id })
    await service.update({ id: created.id, content: "第二条更新" })
    const items = await service.list()

    expect(items.map((item) => item.content)).toEqual(["第一条", "第二条更新"])
    await service.delete({ id: first.id })
    expect((await service.list()).map((item) => item.content)).toEqual(["第二条更新"])
  })

  it("rejects blank content", async () => {
    const service = createQuickInputService(createHarness().deps)
    await expect(service.create({ content: "   " })).rejects.toThrow("内容不能为空")
  })

  it("migrates legacy config quick inputs once and clears the legacy list", async () => {
    const harness = createHarness({
      quickInputs: [
        { id: "legacy-1", content: "旧片段一", directSend: false },
        { id: "legacy-2", content: "旧片段二", directSend: true },
      ],
    })
    const service = createQuickInputService(harness.deps)

    await service.initialize()

    expect((await service.list()).map((item) => ({
      id: item.id,
      content: item.content,
      sortOrder: item.sortOrder,
    }))).toEqual([
      { id: "legacy-1", content: "旧片段一", sortOrder: 10 },
      { id: "legacy-2", content: "旧片段二", sortOrder: 20 },
    ])
    expect(harness.config.global.quickInputs).toEqual([])
    expect((await harness.settings.getSingleton())?.legacyConfigMigratedAt).toBe("2026-06-25T00:00:00.000Z")
  })

  it("does not clear legacy config when item migration fails", async () => {
    const harness = createHarness({
      quickInputs: [{ id: "legacy-1", content: "旧片段", directSend: false }],
      failItemUpsert: true,
    })
    const service = createQuickInputService(harness.deps)

    await expect(service.initialize()).rejects.toThrow("upsert failed")

    expect(harness.config.global.quickInputs).toHaveLength(1)
    expect(await harness.settings.getSingleton()).toEqual({
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
      defaultSeededVersion: null,
    })
  })

  it("seeds defaults for an empty migrated store only once", async () => {
    const harness = createHarness({ appVersion: "1.2.3" })
    const service = createQuickInputService(harness.deps)

    await service.initialize()
    const seeded = await service.list()
    await service.delete({ id: seeded[0]!.id })
    await service.initialize()

    expect((await service.list()).length).toBe(seeded.length - 1)
    expect((await harness.settings.getSingleton())?.defaultSeededVersion).toBe("1.2.3")
  })
})

type HarnessOptions = {
  readonly quickInputs?: SynapseConfig["global"]["quickInputs"]
  readonly failItemUpsert?: boolean
  readonly appVersion?: string
}

function createHarness(options: HarnessOptions = {}) {
  const items = createMemoryNamespace<QuickInputItemEntryV1>({ failUpsert: options.failItemUpsert })
  const settings = createMemoryNamespace<QuickInputSettingsEntryV1>({
    singleton: { schemaVersion: 1, legacyConfigMigratedAt: null, defaultSeededVersion: null },
  })
  const config: SynapseConfig = {
    activeRepoUuid: null,
    repositories: [],
    global: {
      ...DEFAULT_GLOBAL_CONFIG,
      quickInputs: options.quickInputs ?? [],
      defaultQuickInputsSeededVersion: "legacy-version",
    },
    agent: DEFAULT_AGENT_GLOBAL_CONFIG,
  }

  return {
    items,
    settings,
    config,
    deps: {
      items,
      settings,
      loadConfig: async () => config,
      updateConfig: async (patch: SynapseConfigPatch) => {
        if (patch.global?.quickInputs) config.global.quickInputs = patch.global.quickInputs
        return config
      },
      appVersion: options.appVersion ?? "0.0.0-test",
      now: () => new Date("2026-06-25T00:00:00.000Z"),
      createId: () => `id-${items.records.size + 1}`,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends { id?: string }>(options: {
  readonly singleton?: T
  readonly failUpsert?: boolean
} = {}) {
  const events = new EventEmitter()
  let singleton = options.singleton ?? null
  const records = new Map<string, T>()
  const namespace: DataNamespace<T> & { records: Map<string, T> } = {
    name: "memory",
    schemaVersion: 1,
    backend: "json",
    records,
    async getSingleton() { return singleton },
    async setSingleton(value) { singleton = value },
    async clearSingleton() { singleton = null },
    async list() { return Array.from(records.values()) },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) {
      if (options.failUpsert) throw new Error("upsert failed")
      records.set(item.id, item)
    },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
  return namespace
}
```

- [ ] **Step 2: Run service tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/quick-input/main/__tests__/service.test.ts
```

Expected: FAIL because `quick-input/main/service.ts` and shared schemas do not exist.

- [ ] **Step 3: Add shared capability constants**

Create `desktop/app-capabilities/quick-input/shared/capability.ts`:

```ts
export const QUICK_INPUT_APP_ID = "quick-input" as const
export const QUICK_INPUT_ITEMS_NAMESPACE = "app.quick-input.items" as const
export const QUICK_INPUT_SETTINGS_NAMESPACE = "app.quick-input.settings" as const
```

- [ ] **Step 4: Add shared Zod schemas**

Create `desktop/app-capabilities/quick-input/shared/schema.ts`:

```ts
import { z } from "zod"

export const quickInputItemSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  content: z.string().min(1),
  sortOrder: z.number(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})

export const quickInputCreateInputSchema = z.object({
  content: z.string(),
})

export const quickInputUpdateInputSchema = z.object({
  id: z.string().min(1),
  content: z.string(),
})

export const quickInputIdInputSchema = z.object({
  id: z.string().min(1),
})

export const quickInputChangedEventSchema = z.object({
  items: z.array(quickInputItemSchema),
})

export type QuickInputItem = z.infer<typeof quickInputItemSchema>
export type QuickInputCreateInput = z.infer<typeof quickInputCreateInputSchema>
export type QuickInputUpdateInput = z.infer<typeof quickInputUpdateInputSchema>
export type QuickInputIdInput = z.infer<typeof quickInputIdInputSchema>
export type QuickInputChangedEvent = z.infer<typeof quickInputChangedEventSchema>
```

- [ ] **Step 5: Add default quick input content**

Create `desktop/app-capabilities/quick-input/shared/defaults.ts`:

```ts
export const DEFAULT_QUICK_INPUT_CONTENTS = [
  {
    id: "builtin-quick-input-sort",
    content: "帮我捋一下\n把这里的信息重新整理一下，重点放在结论、分歧和下一步。",
  },
  {
    id: "builtin-quick-input-conclusion",
    content: "给个结论\n先说结论，再用几条要点说明理由。",
  },
  {
    id: "builtin-quick-input-problems",
    content: "哪里有问题\n帮我挑一下毛病，重点看不清楚、不完整、前后打架的地方。",
  },
  {
    id: "builtin-quick-input-formal-doc",
    content: "改得像正式文档\n保持原意，把表达改得更清楚、更克制、更适合放进文档。",
  },
  {
    id: "builtin-quick-input-todos",
    content: "整理成待办\n拆成可执行的待办事项，按优先级排一下。",
  },
  {
    id: "builtin-quick-input-desktop-md",
    content: "存到桌面\n整理成一份 Markdown 文件，保存到我的桌面。",
  },
] as const
```

- [ ] **Step 6: Add core service**

Create `desktop/app-capabilities/quick-input/main/service.ts`:

```ts
import { EventEmitter } from "node:events"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { QuickInputItemEntryV1, QuickInputSettingsEntryV1 } from "../../../electron/runtime/data-repo/schemas/quick-input"
import type { SynapseConfig, SynapseConfigPatch } from "../../../src/types/config"
import { DEFAULT_QUICK_INPUT_CONTENTS } from "../shared/defaults"
import type { QuickInputCreateInput, QuickInputIdInput, QuickInputItem, QuickInputUpdateInput } from "../shared/schema"

type QuickInputLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type QuickInputServiceDeps = {
  readonly items: DataNamespace<QuickInputItemEntryV1>
  readonly settings: DataNamespace<QuickInputSettingsEntryV1>
  readonly loadConfig: () => Promise<SynapseConfig>
  readonly updateConfig: (patch: SynapseConfigPatch) => Promise<SynapseConfig>
  readonly appVersion: string
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: QuickInputLogger
}

export type QuickInputService = ReturnType<typeof createQuickInputService>

type QuickInputServiceEvents = {
  changed: [payload: { items: QuickInputItem[] }]
}

class TypedEventEmitter extends EventEmitter {
  override on<K extends keyof QuickInputServiceEvents>(
    eventName: K,
    listener: (...args: QuickInputServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof QuickInputServiceEvents>(
    eventName: K,
    ...args: QuickInputServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createQuickInputService(deps: QuickInputServiceDeps) {
  const events = new TypedEventEmitter()
  const now = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = () => deps.createId?.() ?? crypto.randomUUID()

  async function initialize(): Promise<void> {
    await migrateLegacyConfig()
    await seedDefaults()
  }

  async function list(): Promise<QuickInputItem[]> {
    return (await deps.items.list())
      .sort(compareQuickInputItems)
      .map(toPublicItem)
  }

  async function create(input: QuickInputCreateInput): Promise<QuickInputItem> {
    const content = normalizeContent(input.content)
    const timestamp = now()
    const item: QuickInputItemEntryV1 = {
      id: createId(),
      schemaVersion: 1,
      content,
      sortOrder: await nextSortOrder(),
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await deps.items.upsert(item)
    await emitChanged()
    return toPublicItem(item)
  }

  async function update(input: QuickInputUpdateInput): Promise<QuickInputItem> {
    const existing = await requireItem(input.id)
    const item: QuickInputItemEntryV1 = {
      ...existing,
      content: normalizeContent(input.content),
      updatedAt: now(),
    }
    await deps.items.upsert(item)
    await emitChanged()
    return toPublicItem(item)
  }

  async function deleteItem(input: QuickInputIdInput): Promise<void> {
    await deps.items.remove(input.id)
    await normalizeSortOrders()
    await emitChanged()
  }

  async function pinToTop(input: QuickInputIdInput): Promise<QuickInputItem[]> {
    const current = await deps.items.list()
    if (!current.some((item) => item.id === input.id)) {
      return list()
    }
    const timestamp = now()
    const reordered = [
      ...current.filter((item) => item.id === input.id),
      ...current.filter((item) => item.id !== input.id).sort(compareQuickInputItems),
    ].map((item, index) => ({
      ...item,
      sortOrder: (index + 1) * 10,
      updatedAt: item.id === input.id ? timestamp : item.updatedAt,
    }))
    for (const item of reordered) await deps.items.upsert(item)
    await emitChanged()
    return reordered.map(toPublicItem)
  }

  async function migrateLegacyConfig(): Promise<void> {
    const settings = await loadSettings()
    if (settings.legacyConfigMigratedAt) return

    const config = await deps.loadConfig()
    const legacyItems = config.global.quickInputs.filter((item) => item.content.trim().length > 0)
    const existing = await deps.items.list()

    if (legacyItems.length > 0 && existing.length === 0) {
      const timestamp = now()
      for (const [index, legacy] of legacyItems.entries()) {
        await deps.items.upsert({
          id: legacy.id,
          schemaVersion: 1,
          content: legacy.content,
          sortOrder: (index + 1) * 10,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }

    await deps.updateConfig({ global: { quickInputs: [] } })
    await deps.settings.setSingleton({
      ...settings,
      legacyConfigMigratedAt: now(),
    })
  }

  async function seedDefaults(): Promise<void> {
    const settings = await loadSettings()
    if (settings.defaultSeededVersion === deps.appVersion) return
    if ((await deps.items.list()).length === 0) {
      const timestamp = now()
      for (const [index, item] of DEFAULT_QUICK_INPUT_CONTENTS.entries()) {
        await deps.items.upsert({
          id: item.id,
          schemaVersion: 1,
          content: item.content,
          sortOrder: (index + 1) * 10,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }
    }
    await deps.settings.setSingleton({
      ...settings,
      defaultSeededVersion: deps.appVersion,
    })
    await emitChanged()
  }

  async function loadSettings(): Promise<QuickInputSettingsEntryV1> {
    return await deps.settings.getSingleton() ?? {
      schemaVersion: 1,
      legacyConfigMigratedAt: null,
      defaultSeededVersion: null,
    }
  }

  async function requireItem(id: string): Promise<QuickInputItemEntryV1> {
    const item = await deps.items.get(id)
    if (!item) throw new Error("快捷输入不存在。")
    return item
  }

  async function nextSortOrder(): Promise<number> {
    const items = await deps.items.list()
    return items.reduce((max, item) => Math.max(max, item.sortOrder), 0) + 10
  }

  async function normalizeSortOrders(): Promise<void> {
    const ordered = (await deps.items.list()).sort(compareQuickInputItems)
    for (const [index, item] of ordered.entries()) {
      const sortOrder = (index + 1) * 10
      if (item.sortOrder !== sortOrder) {
        await deps.items.upsert({ ...item, sortOrder })
      }
    }
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", { items: await list() })
  }

  return {
    events,
    initialize,
    list,
    create,
    update,
    delete: deleteItem,
    pinToTop,
  }
}

function normalizeContent(content: string): string {
  if (content.trim().length === 0) throw new Error("内容不能为空。")
  return content
}

function compareQuickInputItems(a: QuickInputItemEntryV1, b: QuickInputItemEntryV1): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
}

function toPublicItem(item: QuickInputItemEntryV1): QuickInputItem {
  return {
    id: item.id,
    schemaVersion: 1,
    content: item.content,
    sortOrder: item.sortOrder,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/quick-input/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit service task**

```bash
git add desktop/app-capabilities/quick-input/shared \
  desktop/app-capabilities/quick-input/main/service.ts \
  desktop/app-capabilities/quick-input/main/__tests__/service.test.ts
git commit -m "feat(quick-input): add service and migration"
```

---

### Task 3: IPC, Preload, And Bootstrap Wiring

**Files:**
- Create: `desktop/app-capabilities/quick-input/main/ipc.ts`
- Create: `desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`

- [ ] **Step 1: Write failing IPC tests**

Create `desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { quickInputIpcModule } from "../ipc"

describe("quickInputIpcModule", () => {
  it("registers quick input channels", () => {
    expect(quickInputIpcModule.methods.list.channel).toBe("synapse:quick-input:list")
    expect(quickInputIpcModule.methods.create.channel).toBe("synapse:quick-input:create")
    expect(quickInputIpcModule.methods.update.channel).toBe("synapse:quick-input:update")
    expect(quickInputIpcModule.methods.delete.channel).toBe("synapse:quick-input:delete")
    expect(quickInputIpcModule.methods.pinToTop.channel).toBe("synapse:quick-input:pin-to-top")
    expect(quickInputIpcModule.events.changed.channel).toBe("synapse:quick-input:changed")
  })

  it("dispatches list through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.quick-input") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(quickInputIpcModule.methods.list.handler(ctx as never, undefined)).resolves.toEqual([])
    expect(service.list).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run IPC tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts
```

Expected: FAIL because `quick-input/main/ipc.ts` does not exist.

- [ ] **Step 3: Add IPC module**

Create `desktop/app-capabilities/quick-input/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { QuickInputService } from "./service"
import {
  quickInputChangedEventSchema,
  quickInputCreateInputSchema,
  quickInputIdInputSchema,
  quickInputItemSchema,
  quickInputUpdateInputSchema,
} from "../shared/schema"

const quickInputEventWiredServices = new WeakSet<QuickInputService>()

function resolveQuickInputService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): QuickInputService {
  const service = ctx.resolve<QuickInputService>("core.quick-input")
  wireQuickInputEvents(ctx, service)
  return service
}

function wireQuickInputEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: QuickInputService,
): void {
  if (quickInputEventWiredServices.has(service)) return
  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(quickInputIpcModule.events.changed.channel, payload)
  })
  quickInputEventWiredServices.add(service)
}

export const quickInputIpcModule: IpcModule = {
  id: "quick-input",
  methods: {
    list: {
      channel: "synapse:quick-input:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(quickInputItemSchema),
      handler: (ctx) => resolveQuickInputService(ctx).list(),
    },
    create: {
      channel: "synapse:quick-input:create",
      kind: "invoke",
      request: quickInputCreateInputSchema,
      response: quickInputItemSchema,
      handler: (ctx, request) => resolveQuickInputService(ctx).create(request),
    },
    update: {
      channel: "synapse:quick-input:update",
      kind: "invoke",
      request: quickInputUpdateInputSchema,
      response: quickInputItemSchema,
      handler: (ctx, request) => resolveQuickInputService(ctx).update(request),
    },
    delete: {
      channel: "synapse:quick-input:delete",
      kind: "invoke",
      request: quickInputIdInputSchema,
      response: z.void(),
      handler: (ctx, request) => resolveQuickInputService(ctx).delete(request),
    },
    pinToTop: {
      channel: "synapse:quick-input:pin-to-top",
      kind: "invoke",
      request: quickInputIdInputSchema,
      response: z.array(quickInputItemSchema),
      handler: (ctx, request) => resolveQuickInputService(ctx).pinToTop(request),
    },
  },
  events: {
    changed: {
      channel: "synapse:quick-input:changed",
      payload: quickInputChangedEventSchema,
    },
  },
}
```

- [ ] **Step 4: Register service in bootstrap**

In `desktop/electron/bootstrap/descriptors.ts`, add imports:

```ts
import { createQuickInputService, type QuickInputService } from "../../app-capabilities/quick-input/main/service"
import {
  QUICK_INPUT_ITEMS_NAMESPACE,
  QUICK_INPUT_SETTINGS_NAMESPACE,
} from "../../app-capabilities/quick-input/shared/capability"
import { SYNAPSE_APP_VERSION } from "../../src/lib/app-version"
import type {
  QuickInputItemEntryV1,
  QuickInputSettingsEntryV1,
} from "../runtime/data-repo/schemas/quick-input"
```

Add a descriptor after `coreTerminalDescriptor`:

```ts
export const coreQuickInputDescriptor: ServiceDescriptor<QuickInputService> = {
  id: "core.quick-input",
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.config"],
  create(ctx) {
    const dataRepo = ctx.registry.get<DataRepository>("core.data-repository")
    return createQuickInputService({
      items: dataRepo.namespace<QuickInputItemEntryV1>(QUICK_INPUT_ITEMS_NAMESPACE),
      settings: dataRepo.namespace<QuickInputSettingsEntryV1>(QUICK_INPUT_SETTINGS_NAMESPACE),
      loadConfig: () => configStore.load(),
      updateConfig: (patch) => configStore.update(patch),
      appVersion: SYNAPSE_APP_VERSION,
      logger: ctx.logger.child("quick-input"),
    })
  },
  async start(instance) {
    await instance.initialize()
  },
}
```

Add `coreQuickInputDescriptor` to the exported descriptor list near other core app capability descriptors. Use `rg -n "coreTerminalDescriptor|coreDataRepositoryDescriptor|allDescriptors|descriptors"` to find the local descriptor array and insert this descriptor after `coreTerminalDescriptor`.

- [ ] **Step 5: Register IPC module**

In `desktop/electron/bootstrap/ipc-registry.ts`, import:

```ts
import { quickInputIpcModule } from "../../app-capabilities/quick-input/main/ipc"
```

Register it after `terminalIpcModule`:

```ts
registry.register(quickInputIpcModule, ctx)
```

Add it to `registeredIpcModules` after `terminalIpcModule`:

```ts
quickInputIpcModule,
```

- [ ] **Step 6: Add bridge types**

Create `desktop/src/types/quick-input.ts`:

```ts
export type SynapseQuickInputItem = {
  readonly id: string
  readonly schemaVersion: 1
  readonly content: string
  readonly sortOrder: number
  readonly createdAt: string
  readonly updatedAt: string
}

export type SynapseQuickInputChangedEvent = {
  readonly items: SynapseQuickInputItem[]
}
```

In `desktop/src/types/bridge.ts`, import those types and add this domain inside `SynapseBridge`:

```ts
quickInput: {
  list: () => Promise<SynapseQuickInputItem[]>
  create: (input: { content: string }) => Promise<SynapseQuickInputItem>
  update: (input: { id: string; content: string }) => Promise<SynapseQuickInputItem>
  delete: (input: { id: string }) => Promise<void>
  pinToTop: (input: { id: string }) => Promise<SynapseQuickInputItem[]>
  onChanged: (listener: (event: SynapseQuickInputChangedEvent) => void) => () => void
}
```

- [ ] **Step 7: Add preload channels and methods**

In `desktop/electron/preload.ts`, add an `IPC_CHANNELS.quickInput` block:

```ts
"quickInput": {
  "list": "synapse:quick-input:list",
  "create": "synapse:quick-input:create",
  "update": "synapse:quick-input:update",
  "delete": "synapse:quick-input:delete",
  "pinToTop": "synapse:quick-input:pin-to-top",
  "changed": "synapse:quick-input:changed",
},
```

Inside the exposed bridge object, add:

```ts
quickInput: {
  list: () => invoke(IPC_CHANNELS.quickInput.list)(),
  create: (input) => invoke(IPC_CHANNELS.quickInput.create)(input),
  update: (input) => invoke(IPC_CHANNELS.quickInput.update)(input),
  delete: (input) => invoke(IPC_CHANNELS.quickInput.delete)(input),
  pinToTop: (input) => invoke(IPC_CHANNELS.quickInput.pinToTop)(input),
  onChanged: createRawPayloadSubscription(
    subscribe,
    IPC_CHANNELS.quickInput.changed,
  ),
},
```

Mirror the same channels in `desktop/electron/generated/ipc-channels.generated.ts`.

- [ ] **Step 8: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts \
  desktop/electron/__tests__/preload.test.ts \
  desktop/electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS after adjusting descriptor tests that assert the service list. Add `"core.quick-input"` to expected descriptor ids if those tests enumerate all services.

- [ ] **Step 9: Commit IPC task**

```bash
git add desktop/app-capabilities/quick-input/main/ipc.ts \
  desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/bootstrap/ipc-registry.ts \
  desktop/electron/preload.ts \
  desktop/electron/generated/ipc-channels.generated.ts \
  desktop/src/types/bridge.ts \
  desktop/src/types/quick-input.ts \
  desktop/electron/__tests__/preload.test.ts \
  desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat(quick-input): expose ipc bridge"
```

---

### Task 4: Standalone Quick Input App UI And Registry

**Files:**
- Create: `desktop/app-capabilities/quick-input/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/quick-input/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/quick-input/renderer/index.tsx`
- Create: `desktop/app-capabilities/quick-input/renderer/assets/icon.svg`
- Test: `desktop/app-capabilities/quick-input/renderer/__tests__/quick-input-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`

- [ ] **Step 1: Write failing app registry and UI tests**

Create `desktop/app-capabilities/quick-input/renderer/__tests__/quick-input-module.test.tsx`:

```tsx
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import type { SynapseBridge } from "../../../../src/types/bridge"
import { QuickInputModule } from "../index"

describe("QuickInputModule", () => {
  it("renders empty state and creates an item", async () => {
    const bridge = createBridge([])
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<QuickInputModule />)
    })

    expect(container.textContent).toContain("还没有快捷输入")
    const addButton = findButton(container, "新增")
    await act(async () => addButton.click())
    const textarea = document.body.querySelector("textarea")!
    await act(async () => {
      textarea.value = "新的快捷输入"
      textarea.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => findButton(document.body, "添加").click())

    expect(bridge.quickInput.create).toHaveBeenCalledWith({ content: "新的快捷输入" })
  })

  it("renders item actions without direct-send controls", async () => {
    createBridge([{ id: "quick-1", schemaVersion: 1, content: "第一行\n第二行", sortOrder: 10, createdAt: "2026-06-25T00:00:00.000Z", updatedAt: "2026-06-25T00:00:00.000Z" }])
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () => {
      root.render(<QuickInputModule />)
    })

    expect(container.textContent).toContain("第一行")
    expect(container.textContent).toContain("第二行")
    expect(container.textContent).not.toContain("直接发送")
    expect(container.querySelector('[aria-label="编辑快捷输入"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="置顶快捷输入"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="删除快捷输入"]')).not.toBeNull()
  })
})

function createBridge(items: SynapseBridge["quickInput"] extends { list: () => Promise<infer T> } ? T : never) {
  const bridge = {
    quickInput: {
      list: vi.fn(async () => items),
      create: vi.fn(async (input: { content: string }) => ({
        id: "created",
        schemaVersion: 1,
        content: input.content,
        sortOrder: 20,
        createdAt: "2026-06-25T00:00:00.000Z",
        updatedAt: "2026-06-25T00:00:00.000Z",
      })),
      update: vi.fn(),
      delete: vi.fn(),
      pinToTop: vi.fn(),
      onChanged: vi.fn(() => () => undefined),
    },
  }
  vi.stubGlobal("window", { ...window, synapse: bridge })
  return bridge
}

function findButton(root: ParentNode, text: string): HTMLButtonElement {
  const button = Array.from(root.querySelectorAll("button"))
    .find((item) => item.textContent?.includes(text))
  if (!button) throw new Error(`Missing button ${text}`)
  return button
}
```

Add a registry test in an existing app registry test file or create `desktop/src/modules/apps/__tests__/quick-input-registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { DEFAULT_DOCK_APP_IDS } from "../dock"
import { getSystemAppManifest, listLaunchableSystemApps } from "../registry"

describe("quick input app registry", () => {
  it("is launchable but not pinned to the default Dock", () => {
    expect(getSystemAppManifest("quick-input")?.name).toBe("快捷输入")
    expect(listLaunchableSystemApps().map((app) => app.id)).toContain("quick-input")
    expect(DEFAULT_DOCK_APP_IDS).not.toContain("quick-input")
  })
})
```

- [ ] **Step 2: Run UI tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/app-capabilities/quick-input/renderer/__tests__/quick-input-module.test.tsx \
  desktop/src/modules/apps/__tests__/quick-input-registry.test.ts
```

Expected: FAIL because the app module and registry entries do not exist.

- [ ] **Step 3: Add app definition, manifest, and icon**

Create `desktop/app-capabilities/quick-input/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { QUICK_INPUT_APP_ID } from "../shared/capability"

export const quickInputAppDefinition = {
  id: QUICK_INPUT_APP_ID,
  namespace: "quick_input",
  type: "system",
  name: "快捷输入",
  windowTitle: "快捷输入",
  dock: { pinnedByDefault: false, order: 260 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_quick_input",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/quick-input/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "./assets/icon.svg"
import { quickInputAppDefinition } from "./app-definition"

export const quickInputAppManifest = {
  ...quickInputAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

Create `desktop/app-capabilities/quick-input/renderer/assets/icon.svg`:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="28" fill="Canvas"/>
  <rect x="24" y="30" width="80" height="68" rx="14" fill="CanvasText"/>
  <rect x="38" y="46" width="52" height="8" rx="4" fill="Canvas"/>
  <rect x="38" y="62" width="40" height="8" rx="4" fill="Canvas"/>
  <rect x="38" y="78" width="26" height="8" rx="4" fill="Canvas"/>
</svg>
```

- [ ] **Step 4: Add quick input renderer module**

Create `desktop/app-capabilities/quick-input/renderer/index.tsx` with a focused list editor. Use this component skeleton and fill only the shown states/actions:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react"
import { ArrowUpToLine, LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import { Button } from "../../../src/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "../../../src/components/ui/dialog"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "../../../src/components/ui/alert-dialog"
import { Label } from "../../../src/components/ui/label"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import type { SynapseQuickInputItem } from "../../../src/types/quick-input"

type DialogMode = { type: "add" } | { type: "edit"; item: SynapseQuickInputItem } | null

export function QuickInputModule() {
  const quickInputBridge = requireBridgeDomain("quickInput")
  const [items, setItems] = useState<SynapseQuickInputItem[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [dialogMode, setDialogMode] = useState<DialogMode>(null)
  const [content, setContent] = useState("")
  const [formError, setFormError] = useState<string | null>(null)
  const [deletingItem, setDeletingItem] = useState<SynapseQuickInputItem | null>(null)

  const refresh = useCallback(async () => {
    setItems(await quickInputBridge.list())
  }, [quickInputBridge])

  useEffect(() => {
    let active = true
    setLoading(true)
    setLoadError(null)
    refresh()
      .catch(() => {
        if (active) setLoadError("加载失败")
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [refresh])

  useEffect(() => quickInputBridge.onChanged((event) => {
    setItems(event.items)
  }), [quickInputBridge])

  const openAdd = () => {
    setDialogMode({ type: "add" })
    setContent("")
    setFormError(null)
  }

  const openEdit = (item: SynapseQuickInputItem) => {
    setDialogMode({ type: "edit", item })
    setContent(item.content)
    setFormError(null)
  }

  const saveDialog = async () => {
    if (!dialogMode || saving) return
    if (content.trim().length === 0) {
      setFormError("内容不能为空。")
      return
    }
    setSaving(true)
    try {
      if (dialogMode.type === "add") {
        await quickInputBridge.create({ content })
      } else {
        await quickInputBridge.update({ id: dialogMode.item.id, content })
      }
      await refresh()
      setDialogMode(null)
      setContent("")
    } catch {
      setFormError("保存失败，请重试。")
    } finally {
      setSaving(false)
    }
  }

  const pinToTop = async (item: SynapseQuickInputItem) => {
    try {
      setItems(await quickInputBridge.pinToTop({ id: item.id }))
    } catch {
      toast.error("置顶失败")
    }
  }

  const deleteItem = async () => {
    if (!deletingItem) return
    setSaving(true)
    try {
      await quickInputBridge.delete({ id: deletingItem.id })
      await refresh()
      setDeletingItem(null)
    } catch {
      toast.error("删除失败")
    } finally {
      setSaving(false)
    }
  }

  return (
    <SystemAppWindowShell>
      <div className="flex h-full min-h-0 flex-col bg-surface p-4">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-base font-medium">快捷输入</h1>
            <Button type="button" variant="outline" size="sm" onClick={openAdd}>
              <Plus />
              新增
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" />
              正在加载
            </div>
          ) : loadError ? (
            <div className="flex items-center gap-2">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void refresh()}>重试</Button>
            </div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">还没有快捷输入</p>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto">
              {items.map((item, index) => (
                <QuickInputRow
                  key={item.id}
                  item={item}
                  pinned={index === 0}
                  disabled={saving}
                  onEdit={() => openEdit(item)}
                  onPin={() => void pinToTop(item)}
                  onDelete={() => setDeletingItem(item)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open && !saving) setDialogMode(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{dialogMode?.type === "edit" ? "编辑快捷输入" : "新增快捷输入"}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="quick-input-content">内容</Label>
            <Textarea id="quick-input-content" value={content} onChange={(event) => { setContent(event.target.value); setFormError(null) }} />
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <Button type="button" disabled={saving} onClick={() => void saveDialog()}>
              {dialogMode?.type === "edit" ? "保存" : "添加"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={deletingItem !== null} onOpenChange={(open) => { if (!open && !saving) setDeletingItem(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除快捷输入</AlertDialogTitle>
            <AlertDialogDescription>确定删除这条快捷输入吗？</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>取消</AlertDialogCancel>
            <Button variant="destructive" disabled={saving} onClick={() => void deleteItem()}>删除</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function QuickInputRow(props: {
  readonly item: SynapseQuickInputItem
  readonly pinned: boolean
  readonly disabled: boolean
  readonly onEdit: () => void
  readonly onPin: () => void
  readonly onDelete: () => void
}) {
  const preview = useMemo(() => quickInputPreview(props.item.content), [props.item.content])
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg bg-background px-3 py-2">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{preview.title}</p>
        {preview.detail ? <p className="truncate text-xs text-muted-foreground">{preview.detail}</p> : null}
      </div>
      <div className="flex items-center gap-1">
        <Button type="button" variant="ghost" size="icon-sm" aria-label="编辑快捷输入" onClick={props.onEdit}><Pencil /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="置顶快捷输入" disabled={props.pinned || props.disabled} onClick={props.onPin}><ArrowUpToLine /></Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="删除快捷输入" disabled={props.disabled} onClick={props.onDelete}><Trash2 /></Button>
      </div>
    </div>
  )
}

function quickInputPreview(content: string): { title: string; detail: string | null } {
  const lines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  return {
    title: lines[0] ?? content.trim(),
    detail: lines.slice(1).join(" ") || null,
  }
}
```

- [ ] **Step 5: Register app id and content**

In `desktop/src/modules/apps/types.ts`, add `"quick-input"` to `SYSTEM_APP_IDS` and `"quick_input"` to `SynapseSystemAppNamespace`.

In `desktop/src/modules/apps/registry.ts`, import and include:

```ts
import { quickInputAppManifest } from "../../../app-capabilities/quick-input/renderer/app-manifest"
```

Add `quickInputAppManifest` to `systemApps` near other utility apps.

In `desktop/src/modules/apps/components/system-app-content.tsx`, import:

```ts
import { QuickInputModule } from "../../../../app-capabilities/quick-input/renderer"
```

Add:

```tsx
if (appId === "quick-input") return <QuickInputModule />
```

- [ ] **Step 6: Run app tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/app-capabilities/quick-input/renderer/__tests__/quick-input-module.test.tsx \
  desktop/src/modules/apps/__tests__/quick-input-registry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit UI task**

```bash
git add desktop/app-capabilities/quick-input/renderer \
  desktop/src/modules/apps/types.ts \
  desktop/src/modules/apps/registry.ts \
  desktop/src/modules/apps/components/system-app-content.tsx \
  desktop/src/modules/apps/__tests__/quick-input-registry.test.ts
git commit -m "feat(quick-input): add standalone app"
```

---

### Task 5: Remove Settings Entry And Config Seeding

**Files:**
- Modify: `desktop/src/modules/settings/data.ts`
- Modify: `desktop/src/modules/settings/index.tsx`
- Modify: `desktop/src/modules/settings/types.ts`
- Modify: `desktop/src/modules/settings/__tests__/settings-categories.test.ts`
- Modify: `desktop/src/modules/settings/__tests__/settings-layout.test.tsx`
- Modify: `desktop/src/constants/defaults.ts`
- Modify: `desktop/src/lib/config.ts`
- Modify: `desktop/src/lib/__tests__/config.test.ts`

- [ ] **Step 1: Update failing tests for removed Settings category**

In `desktop/src/modules/settings/__tests__/settings-categories.test.ts`, replace assertions that include `quick-inputs` and `提示词片段` with assertions that they are absent:

```ts
expect(settingsCategories.map((category) => category.id)).not.toContain("quick-inputs")
expect(settingsCategories.map((category) => category.label)).not.toContain("提示词片段")
```

In `desktop/src/modules/settings/__tests__/settings-layout.test.tsx`, remove tests that render `QuickInputsPanel` through Settings. Add:

```tsx
it("does not render the legacy prompt snippet category", () => {
  render(<SettingsModule />)
  expect(document.body.textContent).not.toContain("提示词片段")
})
```

In `desktop/src/lib/__tests__/config.test.ts`, change default seeding expectations:

```ts
it("keeps legacy quick inputs empty in default config because quick input app owns seeding", () => {
  const config = normalizeSynapseConfig({})
  expect(config.global.quickInputs).toEqual([])
})
```

Keep tests that preserve imported legacy quick inputs before service migration.

- [ ] **Step 2: Run settings/config tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/settings/__tests__/settings-categories.test.ts \
  desktop/src/modules/settings/__tests__/settings-layout.test.tsx \
  desktop/src/lib/__tests__/config.test.ts
```

Expected: FAIL because Settings still has the old category and config still seeds defaults.

- [ ] **Step 3: Remove Settings quick input category**

In `desktop/src/modules/settings/types.ts`, remove `"quick-inputs"` from `SettingsCategoryId`.

In `desktop/src/modules/settings/data.ts`, remove the `TextCursorInput` import and the category block:

```ts
{
  id: "quick-inputs",
  icon: TextCursorInput,
  label: "提示词片段",
  description: "维护常用片段。",
},
```

In `desktop/src/modules/settings/index.tsx`, remove:

```ts
import { QuickInputsPanel } from "@/modules/settings/components/quick-inputs-panel"
```

Remove `handleSaveQuickInputs` and the `activeCategory === "quick-inputs"` render block.

- [ ] **Step 4: Stop config default seeding**

In `desktop/src/constants/defaults.ts`, replace `DEFAULT_QUICK_INPUTS` with an empty legacy default:

```ts
export const DEFAULT_QUICK_INPUTS = [] as const satisfies SynapseQuickInput[]
```

Set:

```ts
quickInputs: DEFAULT_QUICK_INPUTS,
defaultQuickInputsSeededVersion: null,
```

In `desktop/src/lib/config.ts`, update `seedDefaultQuickInputs` or equivalent normalization helper so it returns the normalized legacy quickInputs unchanged and does not append built-ins. Keep directSend normalization for imported legacy config:

```ts
return {
  quickInputs,
  seededVersion: typeof seededVersion === "string" ? seededVersion : null,
}
```

If the helper is now unused outside tests, keep it as a compatibility helper only when it is still called from config normalization.

- [ ] **Step 5: Run settings/config tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/settings/__tests__/settings-categories.test.ts \
  desktop/src/modules/settings/__tests__/settings-layout.test.tsx \
  desktop/src/lib/__tests__/config.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit settings/config cleanup**

```bash
git add desktop/src/modules/settings/data.ts \
  desktop/src/modules/settings/index.tsx \
  desktop/src/modules/settings/types.ts \
  desktop/src/modules/settings/__tests__/settings-categories.test.ts \
  desktop/src/modules/settings/__tests__/settings-layout.test.tsx \
  desktop/src/constants/defaults.ts \
  desktop/src/lib/config.ts \
  desktop/src/lib/__tests__/config.test.ts
git commit -m "refactor(quick-input): remove legacy settings entry"
```

---

### Task 6: Agent Integration Sends Immediately

**Files:**
- Modify: `desktop/src/modules/agent/index.tsx`
- Modify: `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`
- Modify: `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Modify: `desktop/src/modules/agent/components/quick-input-menu.tsx`
- Modify: `desktop/src/modules/agent/slash-menu.ts`
- Modify: relevant Agent tests under `desktop/src/modules/agent/__tests__/`

- [ ] **Step 1: Write failing Agent behavior tests**

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, update the quick input menu test so quick inputs no longer insert:

```tsx
it("sends a quick input from the composer menu and preserves the draft", async () => {
  const onQuickInputSend = vi.fn()
  const { container } = renderComposer({
    draft: "保留草稿",
    quickInputs: [{ id: "quick-1", schemaVersion: 1, content: "继续", sortOrder: 10, createdAt: "2026-06-25T00:00:00.000Z", updatedAt: "2026-06-25T00:00:00.000Z" }],
    onQuickInputSend,
  })

  await clickButton(container, "快捷输入")
  await clickMenuItem("继续")

  expect(onQuickInputSend).toHaveBeenCalledWith("quick-1", "继续")
  expect(getComposerTextarea(container).value).toBe("保留草稿")
})
```

In `desktop/src/modules/agent/__tests__/slash-menu.test.ts`, update quick input candidates:

```ts
expect(toQuickInputSlashCandidates([
  { id: "quick-1", schemaVersion: 1, content: "日报模板\n整理今天完成的工作", sortOrder: 10, createdAt: "2026-06-25T00:00:00.000Z", updatedAt: "2026-06-25T00:00:00.000Z" },
])).toEqual([
  expect.objectContaining({
    id: "quick-input:quick-1",
    kind: "quickInput",
    name: "日报模板",
    sendText: "日报模板\n整理今天完成的工作",
  }),
])
```

In `desktop/src/modules/agent/__tests__/agent-composer.test.tsx`, add slash selection behavior:

```tsx
it("sends quick input slash candidates instead of inserting them", async () => {
  const onQuickInputSend = vi.fn()
  const { container } = renderComposer({
    draft: "/日报",
    slashCandidates: [{
      id: "quick-input:quick-1",
      kind: "quickInput",
      name: "日报模板",
      description: "日报模板",
      sendText: "日报模板\n整理今天完成的工作",
    }],
    onQuickInputSend,
  })

  await chooseSlashCandidate(container, "日报模板")

  expect(onQuickInputSend).toHaveBeenCalledWith("quick-1", "日报模板\n整理今天完成的工作")
})
```

- [ ] **Step 2: Run Agent tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/agent/__tests__/agent-composer.test.tsx \
  desktop/src/modules/agent/__tests__/slash-menu.test.ts \
  desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: FAIL because quick inputs still use `SynapseQuickInput.directSend` and slash candidates only insert.

- [ ] **Step 3: Update slash candidate type**

In `desktop/src/modules/agent/slash-menu.ts`, add `sendText` to `AgentSlashCandidate`:

```ts
readonly sendText?: string
```

Update `toQuickInputSlashCandidates` to accept `readonly SynapseQuickInputItem[]` from `@/types/quick-input` and return candidates like:

```ts
return {
  id: `quick-input:${item.id}`,
  kind: "quickInput" as const,
  name: quickInputSlashName(item.content),
  description: quickInputSlashDescription(item.content),
  sendText: item.content,
}
```

Change the group label from `片段` to `快捷输入`:

```ts
groups.push({ kind: "quickInput", label: "快捷输入", items: quickInputs })
```

Keep `replaceAgentSlashFragment` unchanged for knowledge base, skills, and commands.

- [ ] **Step 4: Update quick input menu**

In `desktop/src/modules/agent/components/quick-input-menu.tsx`, change props:

```ts
readonly quickInputs: readonly SynapseQuickInputItem[]
readonly onSend: (id: string, content: string) => void
```

Remove `onInsert`, `onDirectSend`, and all `directSend` branches. Use `SendHorizontal` for every item. Change labels:

```tsx
aria-label={`发送快捷输入：${quickInputMenuPreview(item.content)}`}
```

Change trigger text:

```tsx
<span>快捷输入</span>
```

- [ ] **Step 5: Update composer quick input callbacks**

In `desktop/src/modules/agent/components/agent-composer.tsx`, change prop names:

```ts
readonly quickInputs?: readonly SynapseQuickInputItem[]
readonly onQuickInputSend?: (id: string, content: string) => void
```

In slash candidate selection, before replacing text, branch:

```ts
if (candidate.kind === "quickInput" && candidate.sendText) {
  onQuickInputSend?.(candidate.id.replace(/^quick-input:/, ""), candidate.sendText)
  setSlashMenuState(null)
  return
}
```

Render:

```tsx
<QuickInputMenu
  quickInputs={quickInputs}
  disabled={disabled}
  onSend={(id, content) => onQuickInputSend?.(id, content)}
/>
```

- [ ] **Step 6: Load quick inputs through bridge in Agent containers**

In `desktop/src/modules/agent/index.tsx` and `desktop/src/modules/agent/components/agent-conversation-window-page.tsx`, replace `config.global.quickInputs ?? []` with state loaded from `window.synapse.quickInput`.

Add a small hook local to Agent, `desktop/src/modules/agent/hooks/use-quick-input-items.ts`:

```ts
import { useEffect, useState } from "react"
import { createRendererLogger } from "@/app-shell/logging"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseQuickInputItem } from "@/types/quick-input"

const logger = createRendererLogger("agent.quick-input")

export function useQuickInputItems(): readonly SynapseQuickInputItem[] {
  const [items, setItems] = useState<SynapseQuickInputItem[]>([])

  useEffect(() => {
    const bridge = getSynapseBridge()?.quickInput
    if (!bridge) return undefined
    let active = true
    bridge.list()
      .then((nextItems) => {
        if (active) setItems(nextItems)
      })
      .catch((error) => {
        logger.warn("Failed to load quick inputs for Agent.", { error })
      })
    const unsubscribe = bridge.onChanged((event) => {
      setItems(event.items)
    })
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return items
}
```

Use it in both Agent entry components and pass the resulting items into `AgentConversationWorkspace`.

- [ ] **Step 7: Update direct send tracking**

In `desktop/src/modules/agent/components/agent-conversation-workspace.tsx`, rename the callback to `onQuickInputSend`. Track id and length:

```ts
onQuickInputSend={(quickInputId, content) =>
  void submitContent(content, {
    preserveDraft: true,
    trackSource: "quick-input-direct",
    quickInputId,
  })}
```

Extend `submitContent` options to carry `quickInputId` and include only `quickInputId` and `contentLength` in telemetry metadata.

- [ ] **Step 8: Run Agent tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/src/modules/agent/__tests__/agent-composer.test.tsx \
  desktop/src/modules/agent/__tests__/slash-menu.test.ts \
  desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx
```

Expected: PASS after updating fixtures from `directSend` legacy objects to `SynapseQuickInputItem`.

- [ ] **Step 9: Commit Agent task**

```bash
git add desktop/src/modules/agent \
  desktop/src/types/quick-input.ts
git commit -m "feat(agent): send quick inputs directly"
```

---

### Task 7: Backup Compatibility

**Files:**
- Modify: `desktop/src/types/backup.ts`
- Modify: `desktop/electron/services/config-backup-service.ts`
- Modify: `desktop/electron/services/__tests__/config-backup-service.test.ts`

- [ ] **Step 1: Write failing backup tests**

In `desktop/electron/services/__tests__/config-backup-service.test.ts`, replace the old export test with:

```ts
it("exports quick input data repository namespaces", async () => {
  vi.mocked(configStore.load).mockResolvedValue(createDefaultConfig())
  vi.mocked(dataRepository.exportAll).mockResolvedValue({
    format: "synapse-backup-v1",
    exportedAt: "2026-06-25T00:00:00.000Z",
    namespaces: [
      {
        name: "app.quick-input.items",
        schemaVersion: 1,
        encrypted: false,
        data: { items: [{ id: "quick-1", schemaVersion: 1, content: "第一行", sortOrder: 10, createdAt: "2026-06-25T00:00:00.000Z", updatedAt: "2026-06-25T00:00:00.000Z" }] },
      },
    ],
  })

  const backup = await createConfigBackupPayload(new Date("2026-06-25T00:00:00.000Z"))

  expect(backup.dataRepository?.namespaces.some((entry) => entry.name === "app.quick-input.items")).toBe(true)
  expect(backup.config.global.quickInputs).toEqual([])
})
```

Add an import test:

```ts
it("accepts legacy backups that still contain config quick inputs", async () => {
  const backup = createBackupPayload({
    quickInputs: [{ id: "legacy-1", content: "旧片段", directSend: false }],
  })

  const parsed = await configBackupService.readImportFromText(JSON.stringify(backup))

  expect(parsed.nextConfig.global.quickInputs).toEqual([
    { id: "legacy-1", content: "旧片段", directSend: false },
  ])
})
```

If `readImportFromText` does not exist, test `parseBackup` through the existing helper already used by the file. Do not expose a new production method only for this assertion.

- [ ] **Step 2: Run backup tests to verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/config-backup-service.test.ts
```

Expected: FAIL because backup payload has no `dataRepository` field.

- [ ] **Step 3: Extend backup type**

In `desktop/src/types/backup.ts`, import `BackupPayload` from the DataRepository type location if available to renderer-safe code. If importing Electron runtime types would cross boundaries, define a serializable mirror:

```ts
export type SynapseDataRepositoryBackupPayload = {
  readonly format: "synapse-backup-v1"
  readonly exportedAt: string
  readonly namespaces: readonly {
    readonly name: string
    readonly schemaVersion: number
    readonly encrypted: boolean
    readonly data: unknown
  }[]
}
```

Add to `SynapseConfigBackup`:

```ts
readonly dataRepository?: SynapseDataRepositoryBackupPayload
```

- [ ] **Step 4: Include DataRepository export**

In `desktop/electron/services/config-backup-service.ts`, import the application DataRepository singleton or service used by bootstrap. If the file currently cannot access it cleanly, add a service dependency setter:

```ts
import type { DataRepository } from "../runtime/data-repo"
```

Add a module-level dependency:

```ts
let dataRepositoryForBackup: Pick<DataRepository, "exportAll" | "importAll"> | null = null

export function setConfigBackupDataRepository(repository: Pick<DataRepository, "exportAll" | "importAll">): void {
  dataRepositoryForBackup = repository
}
```

In `createConfigBackupPayload`, add:

```ts
const dataRepository = dataRepositoryForBackup
  ? await dataRepositoryForBackup.exportAll()
  : undefined
```

Return:

```ts
...(dataRepository ? { dataRepository } : undefined),
```

When importing, after config validation succeeds and before returning the prepared import, keep `dataRepository` on the parsed backup. When applying the import, call:

```ts
if (backup.dataRepository && dataRepositoryForBackup) {
  await dataRepositoryForBackup.importAll(backup.dataRepository, { merge: false })
}
```

Keep `config.global.quickInputs` validation unchanged so old backups can still feed the quick input migration service.

- [ ] **Step 5: Wire backup repository dependency**

In `desktop/electron/bootstrap/descriptors.ts`, after creating `core.data-repository`, call `setConfigBackupDataRepository(dataRepository)` from the place that wires services. If there is an existing config backup descriptor, do it there. If no descriptor exists, add this call in the `coreDataRepositoryDescriptor.start` hook so the backup service can export DataRepository namespaces.

- [ ] **Step 6: Run backup tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/config-backup-service.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit backup task**

```bash
git add desktop/src/types/backup.ts \
  desktop/electron/services/config-backup-service.ts \
  desktop/electron/services/__tests__/config-backup-service.test.ts \
  desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(quick-input): include app data in backups"
```

---

### Task 8: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add a bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 提示词片段升级为独立的“快捷输入”应用；原有片段会自动迁移，Agent 对话中选择快捷输入会直接发送。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/runtime/data-repo/__tests__/schemas.test.ts \
  desktop/app-capabilities/quick-input/main/__tests__/service.test.ts \
  desktop/app-capabilities/quick-input/main/__tests__/ipc.test.ts \
  desktop/app-capabilities/quick-input/renderer/__tests__/quick-input-module.test.tsx \
  desktop/src/modules/apps/__tests__/quick-input-registry.test.ts \
  desktop/src/modules/settings/__tests__/settings-categories.test.ts \
  desktop/src/modules/settings/__tests__/settings-layout.test.tsx \
  desktop/src/lib/__tests__/config.test.ts \
  desktop/src/modules/agent/__tests__/agent-composer.test.tsx \
  desktop/src/modules/agent/__tests__/slash-menu.test.ts \
  desktop/src/modules/agent/__tests__/agent-slash-menu.test.tsx \
  desktop/src/modules/agent/__tests__/pending-agent-session.test.tsx \
  desktop/electron/services/__tests__/config-backup-service.test.ts \
  desktop/electron/__tests__/preload.test.ts \
  desktop/electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints and type check**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Inspect changed files**

Run:

```bash
git status --short
git diff --check
```

Expected: `git diff --check` exits 0. `git status --short` shows only files intentionally changed by this implementation.

- [ ] **Step 5: Commit verification task**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note quick input app migration"
```

---

## Self-Review

- Spec coverage: The plan covers app package structure, app namespace schemas, migration, seeding, launcher-only entry, Settings removal, Agent send-immediately behavior, backup compatibility, release notes, and AGENTS.md was already updated in the design commit.
- Placeholder scan: The plan contains concrete file paths, snippets, commands, and expected outcomes for every task.
- Type consistency: The active item type is `SynapseQuickInputItem` / `QuickInputItem` with `schemaVersion`, `content`, `sortOrder`, `createdAt`, and `updatedAt`; legacy `SynapseQuickInput.directSend` appears only in config migration and old backup compatibility.
