# Agent Personas App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new “智能体” system app that manages built-in and user-created persona configurations without changing the existing Agent conversation runtime.

**Architecture:** Add a new `desktop/app-capabilities/agent-personas/` capability package with shared zod contracts, a main-process service backed by DataRepository, IPC bridge methods, and a renderer management UI. Built-in personas live in code and are merged with user records at service read time; only user records are stored in `app.agent-personas.items`.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vite 8, shadcn/ui, Tailwind CSS 4, zod, Vitest, Synapse DataRepository, generated IPC channels.

---

## File Structure

- Create `desktop/app-capabilities/agent-personas/shared/capability.ts`: app id, namespace, and DataRepository namespace constants.
- Create `desktop/app-capabilities/agent-personas/shared/schema.ts`: zod schemas and public types for personas, create/update/delete inputs, and change events.
- Create `desktop/app-capabilities/agent-personas/shared/defaults.ts`: fixed built-in “中英翻译” persona.
- Create `desktop/electron/runtime/data-repo/schemas/agent-personas.ts`: DataRepository schema for user-created personas.
- Modify `desktop/electron/runtime/data-repo/schemas/index.ts`: export and register the new schema.
- Modify `desktop/electron/runtime/data-repo/factory.ts`: add a sqlite index for created time.
- Create `desktop/app-capabilities/agent-personas/main/service.ts`: list/create/update/delete service and change events.
- Create `desktop/app-capabilities/agent-personas/main/ipc.ts`: IPC module for renderer bridge.
- Modify `desktop/electron/bootstrap/descriptors.ts`: register `core.agent-personas`.
- Modify `desktop/electron/bootstrap/registry.ts`: register `coreAgentPersonasDescriptor` in the global ServiceRegistry.
- Modify `desktop/electron/bootstrap/index.ts`: export `coreAgentPersonasDescriptor` from the bootstrap barrel.
- Modify `desktop/electron/bootstrap/ipc-registry.ts`: register the new IPC module.
- Modify `desktop/electron/preload.ts`: expose `window.synapse.agentPersonas`.
- Modify `desktop/src/types/bridge.ts`: add bridge types for `agentPersonas`.
- Create `desktop/src/types/agent-persona.ts`: renderer-facing type aliases.
- Create `desktop/app-capabilities/agent-personas/renderer/app-definition.ts`: system app definition.
- Create `desktop/app-capabilities/agent-personas/renderer/app-manifest.ts`: system app manifest, reusing the existing Agent icon asset for V1.
- Create `desktop/app-capabilities/agent-personas/renderer/index.tsx`: management UI.
- Modify `desktop/src/modules/apps/types.ts`: add system app id and namespace.
- Modify `desktop/src/modules/apps/registry.ts`: add manifest to app launcher registry.
- Modify `desktop/src/modules/apps/definitions.ts`: add definition to Electron-safe app definitions.
- Modify `desktop/src/modules/apps/components/system-app-content.tsx`: render the new app.
- Modify `RELEASE_NOTES_PENDING.md`: add user-facing release note.
- Add tests under `desktop/app-capabilities/agent-personas/main/__tests__/`, `desktop/app-capabilities/agent-personas/renderer/__tests__/`, and existing registry/schema test folders.

---

### Task 1: Shared Contracts And DataRepository Schema

**Files:**
- Create: `desktop/app-capabilities/agent-personas/shared/capability.ts`
- Create: `desktop/app-capabilities/agent-personas/shared/schema.ts`
- Create: `desktop/app-capabilities/agent-personas/shared/defaults.ts`
- Create: `desktop/electron/runtime/data-repo/schemas/agent-personas.ts`
- Create: `desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts`
- Create: `desktop/src/types/agent-persona.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/factory.ts`

- [ ] **Step 1: Write the failing schema tests**

Create `desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  agentPersonaItemsSchema,
  type AgentPersonaItemEntryV1,
} from "../schemas/agent-personas"
import { allSchemas } from "../schemas"
import { sqliteIndexesFor } from "../factory"

describe("agent persona DataRepository schema", () => {
  it("accepts user persona records", () => {
    const entry: AgentPersonaItemEntryV1 = {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断和下一步。",
      systemPrompt: "你是产品顾问，先给结论，再列原因。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    }

    expect(agentPersonaItemsSchema.validate(entry)).toBe(true)
  })

  it("rejects blank required fields and builtin records", () => {
    expect(agentPersonaItemsSchema.validate({
      id: "persona-1",
      schemaVersion: 1,
      name: " ",
      description: "简介",
      systemPrompt: "提示词",
      providerModel: null,
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })).toBe(false)

    expect(agentPersonaItemsSchema.validate({
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译，保留原意、语气和格式。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      source: "builtin",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })).toBe(false)
  })

  it("registers the namespace and sqlite index", () => {
    expect(allSchemas.some((schema) => schema.name === "app.agent-personas.items")).toBe(true)
    expect(sqliteIndexesFor("app.agent-personas.items")).toEqual([
      "json_extract(value, '$.createdAt'), id",
    ])
  })
})
```

- [ ] **Step 2: Run the schema test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts
```

Expected: FAIL because `../schemas/agent-personas` does not exist.

- [ ] **Step 3: Add shared constants**

Create `desktop/app-capabilities/agent-personas/shared/capability.ts`:

```ts
export const AGENT_PERSONAS_APP_ID = "agent-personas" as const
export const AGENT_PERSONAS_ITEMS_NAMESPACE = "app.agent-personas.items" as const
```

- [ ] **Step 4: Add shared zod schemas**

Create `desktop/app-capabilities/agent-personas/shared/schema.ts`:

```ts
import { z } from "zod"

export const agentPersonaModelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])

export const agentPersonaProviderModelSchema = z.object({
  providerId: z.string().min(1),
  modelTier: agentPersonaModelTierSchema,
})

export const agentPersonaSourceSchema = z.enum(["builtin", "user"])

export const agentPersonaSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1),
  description: z.string().min(1),
  systemPrompt: z.string().min(1),
  providerModel: agentPersonaProviderModelSchema.nullable(),
  source: agentPersonaSourceSchema,
  readonly: z.boolean().optional(),
  createdAt: z.string().min(1).optional(),
  updatedAt: z.string().min(1).optional(),
})

export const agentPersonaCreateInputSchema = z.object({
  name: z.string(),
  description: z.string(),
  systemPrompt: z.string(),
  providerModel: agentPersonaProviderModelSchema.nullable().optional(),
})

export const agentPersonaUpdateInputSchema = agentPersonaCreateInputSchema.extend({
  id: z.string().min(1),
})

export const agentPersonaIdInputSchema = z.object({
  id: z.string().min(1),
})

export const agentPersonaChangedEventSchema = z.object({
  items: z.array(agentPersonaSchema),
})

export type AgentPersonaModelTier = z.infer<typeof agentPersonaModelTierSchema>
export type AgentPersonaProviderModel = z.infer<typeof agentPersonaProviderModelSchema>
export type AgentPersona = z.infer<typeof agentPersonaSchema>
export type AgentPersonaCreateInput = z.infer<typeof agentPersonaCreateInputSchema>
export type AgentPersonaUpdateInput = z.infer<typeof agentPersonaUpdateInputSchema>
export type AgentPersonaIdInput = z.infer<typeof agentPersonaIdInputSchema>
export type AgentPersonaChangedEvent = z.infer<typeof agentPersonaChangedEventSchema>
```

- [ ] **Step 5: Add the built-in persona**

Create `desktop/app-capabilities/agent-personas/shared/defaults.ts`:

```ts
import type { AgentPersona } from "./schema"

export const BUILTIN_ZH_EN_TRANSLATOR_ID = "builtin-zh-en-translator" as const

export const BUILTIN_AGENT_PERSONAS = [
  {
    id: BUILTIN_ZH_EN_TRANSLATOR_ID,
    schemaVersion: 1,
    name: "中英翻译",
    description: "在中文和英文之间互译，保留原意、语气和格式。",
    systemPrompt: [
      "你是中英翻译智能体。用户输入中文时翻译成英文，输入英文时翻译成中文。",
      "保持原意、语气、格式和段落结构，不添加解释，不扩写内容。",
      "遇到术语、代码、路径、命令、变量名、品牌名时保持准确；无法确定专有名词时保留原文。",
    ].join("\n"),
    providerModel: null,
    source: "builtin",
    readonly: true,
  },
] as const satisfies readonly AgentPersona[]

export function isBuiltinAgentPersonaId(id: string): boolean {
  return BUILTIN_AGENT_PERSONAS.some((item) => item.id === id)
}
```

- [ ] **Step 6: Add renderer-facing type aliases**

Create `desktop/src/types/agent-persona.ts`:

```ts
import type {
  AgentPersona,
  AgentPersonaChangedEvent,
  AgentPersonaCreateInput,
  AgentPersonaIdInput,
  AgentPersonaProviderModel,
  AgentPersonaUpdateInput,
} from "../../app-capabilities/agent-personas/shared/schema"

export type SynapseAgentPersona = AgentPersona
export type SynapseAgentPersonaProviderModel = AgentPersonaProviderModel
export type SynapseAgentPersonaCreateInput = AgentPersonaCreateInput
export type SynapseAgentPersonaUpdateInput = AgentPersonaUpdateInput
export type SynapseAgentPersonaIdInput = AgentPersonaIdInput
export type SynapseAgentPersonaChangedEvent = AgentPersonaChangedEvent
```

- [ ] **Step 7: Add the DataRepository schema**

Create `desktop/electron/runtime/data-repo/schemas/agent-personas.ts`:

```ts
import type { Migration, NamespaceSchema } from "../types"
import { AGENT_PERSONAS_ITEMS_NAMESPACE } from "../../../../app-capabilities/agent-personas/shared/capability"
import type { AgentPersonaModelTier } from "../../../../app-capabilities/agent-personas/shared/schema"

export interface AgentPersonaProviderModelEntryV1 extends Record<string, unknown> {
  providerId: string
  modelTier: AgentPersonaModelTier
}

export interface AgentPersonaItemEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  name: string
  description: string
  systemPrompt: string
  providerModel: AgentPersonaProviderModelEntryV1 | null
  source: "user"
  createdAt: string
  updatedAt: string
}

const noMigrations: readonly Migration[] = []
const modelTiers = new Set(["default", "haiku", "sonnet", "opus"])

export const agentPersonaItemsSchema: NamespaceSchema<AgentPersonaItemEntryV1> = {
  name: AGENT_PERSONAS_ITEMS_NAMESPACE,
  backend: "sqlite",
  currentVersion: 1,
  migrations: noMigrations,
  validate: isAgentPersonaItemEntryV1,
  encrypted: false,
}

function isAgentPersonaItemEntryV1(value: unknown): value is AgentPersonaItemEntryV1 {
  if (!isRecord(value)) return false
  return value.schemaVersion === 1
    && typeof value.id === "string"
    && value.id.trim().length > 0
    && typeof value.name === "string"
    && value.name.trim().length > 0
    && typeof value.description === "string"
    && value.description.trim().length > 0
    && typeof value.systemPrompt === "string"
    && value.systemPrompt.trim().length > 0
    && isNullableProviderModel(value.providerModel)
    && value.source === "user"
    && isIsoDateString(value.createdAt)
    && isIsoDateString(value.updatedAt)
}

function isNullableProviderModel(value: unknown): value is AgentPersonaProviderModelEntryV1 | null {
  if (value === null) return true
  if (!isRecord(value)) return false
  return typeof value.providerId === "string"
    && value.providerId.trim().length > 0
    && typeof value.modelTier === "string"
    && modelTiers.has(value.modelTier)
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

- [ ] **Step 8: Register the DataRepository schema**

Modify `desktop/electron/runtime/data-repo/schemas/index.ts`.

Add this export near the quick-input export:

```ts
export {
  agentPersonaItemsSchema,
  type AgentPersonaItemEntryV1,
  type AgentPersonaProviderModelEntryV1,
} from "./agent-personas"
```

Add this import near the quick-input import:

```ts
import { agentPersonaItemsSchema } from "./agent-personas"
```

Add the schema to `allSchemas` after `quickInputSettingsSchema`:

```ts
  quickInputItemsSchema,
  quickInputSettingsSchema,
  agentPersonaItemsSchema,
  soundNotifierSettingsSchemaDefinition,
```

- [ ] **Step 9: Add the sqlite index**

Modify `desktop/electron/runtime/data-repo/factory.ts`.

Add this case to `sqliteIndexesFor()` after the quick-input case:

```ts
    case "app.agent-personas.items":
      return ["json_extract(value, '$.createdAt'), id"]
```

- [ ] **Step 10: Run the schema test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts
```

Expected: PASS.

- [ ] **Step 11: Commit Task 1**

```bash
git add \
  desktop/app-capabilities/agent-personas/shared/capability.ts \
  desktop/app-capabilities/agent-personas/shared/schema.ts \
  desktop/app-capabilities/agent-personas/shared/defaults.ts \
  desktop/src/types/agent-persona.ts \
  desktop/electron/runtime/data-repo/schemas/agent-personas.ts \
  desktop/electron/runtime/data-repo/schemas/index.ts \
  desktop/electron/runtime/data-repo/factory.ts \
  desktop/electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts
git commit -m "feat: add agent persona data schema"
```

---

### Task 2: Agent Persona Service

**Files:**
- Create: `desktop/app-capabilities/agent-personas/main/service.ts`
- Create: `desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts`

- [ ] **Step 1: Write the failing service tests**

Create `desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts`:

```ts
import { EventEmitter } from "node:events"
import { describe, expect, it, vi } from "vitest"
import type { DataNamespace } from "../../../../electron/runtime/data-repo"
import type { AgentPersonaItemEntryV1 } from "../../../../electron/runtime/data-repo/schemas/agent-personas"
import { BUILTIN_ZH_EN_TRANSLATOR_ID } from "../../shared/defaults"
import { createAgentPersonaService } from "../service"

describe("AgentPersonaService", () => {
  it("lists built-in personas before user personas", async () => {
    const harness = createHarness()
    harness.items.records.set("user-1", {
      id: "user-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      source: "user",
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    })

    const service = createAgentPersonaService(harness.deps)

    await expect(service.list()).resolves.toMatchObject([
      { id: BUILTIN_ZH_EN_TRANSLATOR_ID, source: "builtin", readonly: true },
      { id: "user-1", source: "user", readonly: false },
    ])
  })

  it("creates, updates, and deletes user personas", async () => {
    const harness = createHarness()
    const service = createAgentPersonaService(harness.deps)
    const changed = vi.fn()
    service.events.on("changed", changed)

    const created = await service.create({
      name: "  产品顾问  ",
      description: "  整理产品判断  ",
      systemPrompt: "  你是产品顾问。  ",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
    })
    expect(created).toMatchObject({
      id: "id-1",
      name: "产品顾问",
      description: "整理产品判断",
      systemPrompt: "你是产品顾问。",
      providerModel: { providerId: "claude", modelTier: "sonnet" },
      source: "user",
      readonly: false,
    })

    const updated = await service.update({
      id: created.id,
      name: "翻译助手",
      description: "处理中英文本。",
      systemPrompt: "你是翻译助手。",
      providerModel: null,
    })
    expect(updated).toMatchObject({
      id: created.id,
      name: "翻译助手",
      providerModel: null,
    })

    await service.delete({ id: created.id })
    expect((await service.list()).map((item) => item.id)).toEqual([BUILTIN_ZH_EN_TRANSLATOR_ID])
    expect(changed).toHaveBeenCalled()
  })

  it("rejects blank required fields", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.create({
      name: "",
      description: "简介",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("名称不能为空")

    await expect(service.create({
      name: "名称",
      description: " ",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("简介不能为空")

    await expect(service.create({
      name: "名称",
      description: "简介",
      systemPrompt: "",
      providerModel: null,
    })).rejects.toThrow("系统提示词不能为空")
  })

  it("rejects updates and deletes for built-in personas", async () => {
    const service = createAgentPersonaService(createHarness().deps)

    await expect(service.update({
      id: BUILTIN_ZH_EN_TRANSLATOR_ID,
      name: "中英翻译",
      description: "描述",
      systemPrompt: "提示词",
      providerModel: null,
    })).rejects.toThrow("内置智能体不可编辑")

    await expect(service.delete({ id: BUILTIN_ZH_EN_TRANSLATOR_ID }))
      .rejects.toThrow("内置智能体不可删除")
  })
})

function createHarness() {
  const items = createMemoryNamespace<AgentPersonaItemEntryV1>()
  return {
    items,
    deps: {
      items,
      now: () => new Date("2026-06-30T00:00:00.000Z"),
      createId: () => `id-${items.records.size + 1}`,
      logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
    },
  }
}

function createMemoryNamespace<T extends { id: string }>(): DataNamespace<T> & { records: Map<string, T> } {
  const events = new EventEmitter()
  const records = new Map<string, T>()
  return {
    name: "memory",
    schemaVersion: 1,
    backend: "sqlite",
    records,
    async getSingleton() { return null },
    async setSingleton() {},
    async clearSingleton() {},
    async list() { return Array.from(records.values()) },
    async count() { return records.size },
    async get(id) { return records.get(id) ?? null },
    async upsert(item) { records.set(item.id, item) },
    async remove(id) { records.delete(id) },
    onChange(listener) {
      events.on("change", listener)
      return () => events.off("change", listener)
    },
  }
}
```

- [ ] **Step 2: Run the service test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/service.test.ts
```

Expected: FAIL because `../service` does not exist.

- [ ] **Step 3: Implement the service**

Create `desktop/app-capabilities/agent-personas/main/service.ts`:

```ts
import { EventEmitter } from "node:events"
import { randomUUID } from "node:crypto"

import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentPersonaItemEntryV1 } from "../../../electron/runtime/data-repo/schemas/agent-personas"
import {
  BUILTIN_AGENT_PERSONAS,
  isBuiltinAgentPersonaId,
} from "../shared/defaults"
import type {
  AgentPersona,
  AgentPersonaCreateInput,
  AgentPersonaIdInput,
  AgentPersonaProviderModel,
  AgentPersonaUpdateInput,
} from "../shared/schema"

type AgentPersonaLogger = {
  warn(message: string, meta?: Record<string, unknown>): void
  error(message: string, meta?: Record<string, unknown>): void
  info(message: string, meta?: Record<string, unknown>): void
  debug(message: string, meta?: Record<string, unknown>): void
}

export type AgentPersonaServiceDeps = {
  readonly items: DataNamespace<AgentPersonaItemEntryV1>
  readonly now?: () => Date
  readonly createId?: () => string
  readonly logger: AgentPersonaLogger
}

type AgentPersonaServiceEvents = {
  changed: [payload: { items: AgentPersona[] }]
}

class TypedAgentPersonaEventEmitter extends EventEmitter {
  override on<K extends keyof AgentPersonaServiceEvents>(
    eventName: K,
    listener: (...args: AgentPersonaServiceEvents[K]) => void,
  ): this {
    return super.on(eventName, listener)
  }

  override emit<K extends keyof AgentPersonaServiceEvents>(
    eventName: K,
    ...args: AgentPersonaServiceEvents[K]
  ): boolean {
    return super.emit(eventName, ...args)
  }
}

export function createAgentPersonaService(deps: AgentPersonaServiceDeps) {
  const events = new TypedAgentPersonaEventEmitter()
  const timestamp = () => (deps.now ?? (() => new Date()))().toISOString()
  const createId = () => deps.createId?.() ?? randomUUID()

  async function list(): Promise<AgentPersona[]> {
    const userItems = (await deps.items.list())
      .sort(compareUserItems)
      .map(toPublicUserItem)
    return [...BUILTIN_AGENT_PERSONAS, ...userItems]
  }

  async function create(input: AgentPersonaCreateInput): Promise<AgentPersona> {
    const now = timestamp()
    const item: AgentPersonaItemEntryV1 = {
      id: createId(),
      schemaVersion: 1,
      name: normalizeRequired(input.name, "名称不能为空。"),
      description: normalizeRequired(input.description, "简介不能为空。"),
      systemPrompt: normalizeRequired(input.systemPrompt, "系统提示词不能为空。"),
      providerModel: normalizeProviderModel(input.providerModel ?? null),
      source: "user",
      createdAt: now,
      updatedAt: now,
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicUserItem(item)
  }

  async function update(input: AgentPersonaUpdateInput): Promise<AgentPersona> {
    if (isBuiltinAgentPersonaId(input.id)) {
      throw new Error("内置智能体不可编辑。")
    }

    const existing = await requireUserItem(input.id)
    const item: AgentPersonaItemEntryV1 = {
      ...existing,
      name: normalizeRequired(input.name, "名称不能为空。"),
      description: normalizeRequired(input.description, "简介不能为空。"),
      systemPrompt: normalizeRequired(input.systemPrompt, "系统提示词不能为空。"),
      providerModel: normalizeProviderModel(input.providerModel ?? null),
      updatedAt: timestamp(),
    }

    await deps.items.upsert(item)
    await emitChanged()
    return toPublicUserItem(item)
  }

  async function deleteItem(input: AgentPersonaIdInput): Promise<void> {
    if (isBuiltinAgentPersonaId(input.id)) {
      throw new Error("内置智能体不可删除。")
    }
    await requireUserItem(input.id)
    await deps.items.remove(input.id)
    await emitChanged()
  }

  async function requireUserItem(id: string): Promise<AgentPersonaItemEntryV1> {
    const item = await deps.items.get(id)
    if (!item) throw new Error("智能体不存在。")
    return item
  }

  async function emitChanged(): Promise<void> {
    events.emit("changed", { items: await list() })
  }

  return {
    events,
    list,
    create,
    update,
    delete: deleteItem,
  }
}

export type AgentPersonaService = ReturnType<typeof createAgentPersonaService>

function normalizeRequired(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized) throw new Error(message)
  return normalized
}

function normalizeProviderModel(value: AgentPersonaProviderModel | null): AgentPersonaProviderModel | null {
  if (!value) return null
  return {
    providerId: normalizeRequired(value.providerId, "模型供应商不能为空。"),
    modelTier: value.modelTier,
  }
}

function compareUserItems(a: AgentPersonaItemEntryV1, b: AgentPersonaItemEntryV1): number {
  return Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.id.localeCompare(b.id)
}

function toPublicUserItem(item: AgentPersonaItemEntryV1): AgentPersona {
  return {
    id: item.id,
    schemaVersion: 1,
    name: item.name,
    description: item.description,
    systemPrompt: item.systemPrompt,
    providerModel: item.providerModel,
    source: "user",
    readonly: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}
```

- [ ] **Step 4: Run the service test and verify it passes**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

```bash
git add desktop/app-capabilities/agent-personas/main/service.ts \
  desktop/app-capabilities/agent-personas/main/__tests__/service.test.ts
git commit -m "feat: add agent persona service"
```

---

### Task 3: IPC, Bootstrap, And Bridge

**Files:**
- Create: `desktop/app-capabilities/agent-personas/main/ipc.ts`
- Create: `desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/index.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/src/types/bridge.ts`
- Generate: `desktop/electron/generated/ipc-channels.generated.ts`

- [ ] **Step 1: Write the failing IPC test**

Create `desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { agentPersonasIpcModule } from "../ipc"

describe("agentPersonasIpcModule", () => {
  it("registers agent persona channels", () => {
    expect(agentPersonasIpcModule.methods.list.channel).toBe("synapse:agent-personas:list")
    expect(agentPersonasIpcModule.methods.create.channel).toBe("synapse:agent-personas:create")
    expect(agentPersonasIpcModule.methods.update.channel).toBe("synapse:agent-personas:update")
    expect(agentPersonasIpcModule.methods.delete.channel).toBe("synapse:agent-personas:delete")
    expect(agentPersonasIpcModule.events.changed.channel).toBe("synapse:agent-personas:changed")
  })

  it("dispatches list through the core service", async () => {
    const service = {
      events: { on: vi.fn() },
      list: vi.fn(async () => []),
    }
    const ctx = {
      resolve: vi.fn((id: string) => {
        if (id === "core.agent-personas") return service
        if (id === "core.window-manager") return { broadcast: vi.fn() }
        throw new Error(id)
      }),
    }

    await expect(agentPersonasIpcModule.methods.list.handler(ctx as never, undefined))
      .resolves.toEqual([])
    expect(service.list).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the IPC test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/ipc.test.ts
```

Expected: FAIL because `../ipc` does not exist.

- [ ] **Step 3: Implement the IPC module**

Create `desktop/app-capabilities/agent-personas/main/ipc.ts`:

```ts
import { z } from "zod"

import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { WindowManager } from "../../../electron/runtime/window"
import type { AgentPersonaService } from "./service"
import {
  agentPersonaChangedEventSchema,
  agentPersonaCreateInputSchema,
  agentPersonaIdInputSchema,
  agentPersonaSchema,
  agentPersonaUpdateInputSchema,
} from "../shared/schema"

const wiredServices = new WeakSet<AgentPersonaService>()

function resolveAgentPersonaService(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): AgentPersonaService {
  const service = ctx.resolve<AgentPersonaService>("core.agent-personas")
  wireAgentPersonaEvents(ctx, service)
  return service
}

function wireAgentPersonaEvents(
  ctx: Parameters<IpcModule["methods"][string]["handler"]>[0],
  service: AgentPersonaService,
): void {
  if (wiredServices.has(service)) return

  const windowManager = ctx.resolve<WindowManager>("core.window-manager")
  service.events.on("changed", (payload) => {
    windowManager.broadcast(agentPersonasIpcModule.events.changed.channel, payload)
  })
  wiredServices.add(service)
}

export const agentPersonasIpcModule: IpcModule = {
  id: "agentPersonas",
  methods: {
    list: {
      channel: "synapse:agent-personas:list",
      kind: "invoke",
      request: z.void(),
      response: z.array(agentPersonaSchema),
      handler: (ctx) => resolveAgentPersonaService(ctx).list(),
    },
    create: {
      channel: "synapse:agent-personas:create",
      kind: "invoke",
      request: agentPersonaCreateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaCreateInputSchema>) =>
        resolveAgentPersonaService(ctx).create(request),
    },
    update: {
      channel: "synapse:agent-personas:update",
      kind: "invoke",
      request: agentPersonaUpdateInputSchema,
      response: agentPersonaSchema,
      handler: (ctx, request: z.infer<typeof agentPersonaUpdateInputSchema>) =>
        resolveAgentPersonaService(ctx).update(request),
    },
    delete: {
      channel: "synapse:agent-personas:delete",
      kind: "invoke",
      request: agentPersonaIdInputSchema,
      response: z.void(),
      handler: (ctx, request: z.infer<typeof agentPersonaIdInputSchema>) =>
        resolveAgentPersonaService(ctx).delete(request),
    },
  },
  events: {
    changed: {
      channel: "synapse:agent-personas:changed",
      kind: "event",
      payload: agentPersonaChangedEventSchema,
    },
  },
}
```

- [ ] **Step 4: Register the core service in bootstrap descriptors**

Modify `desktop/electron/bootstrap/descriptors.ts`.

Add imports near the quick-input imports:

```ts
import { createAgentPersonaService, type AgentPersonaService } from "../../app-capabilities/agent-personas/main/service"
import { AGENT_PERSONAS_ITEMS_NAMESPACE } from "../../app-capabilities/agent-personas/shared/capability"
```

Add the DataRepository type import near `QuickInputItemEntryV1`:

```ts
  AgentPersonaItemEntryV1,
```

Add a descriptor after `coreQuickInputDescriptor`:

```ts
export const coreAgentPersonasDescriptor: ServiceDescriptor<AgentPersonaService> = {
  id: "core.agent-personas",
  criticality: "degraded",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createAgentPersonaService({
      items: dataRepository.namespace<AgentPersonaItemEntryV1>(AGENT_PERSONAS_ITEMS_NAMESPACE),
      logger: ctx.logger.child("agent-personas"),
    })
  },
}
```

- [ ] **Step 5: Register the core service in the ServiceRegistry**

Modify `desktop/electron/bootstrap/registry.ts`.

Add `coreAgentPersonasDescriptor` to the import from `./descriptors` next to `coreQuickInputDescriptor`:

```ts
  coreQuickInputDescriptor,
  coreAgentPersonasDescriptor,
  coreRelayDescriptor,
```

Register it immediately after `coreQuickInputDescriptor`:

```ts
  registry.register(coreTerminalDescriptor)
  registry.register(coreQuickInputDescriptor)
  registry.register(coreAgentPersonasDescriptor)
  registry.register(coreSoundNotifierDescriptor)
```

Modify `desktop/electron/bootstrap/index.ts`.

Export it next to `coreQuickInputDescriptor`:

```ts
  coreQuickInputDescriptor,
  coreAgentPersonasDescriptor,
  coreUpdateDescriptor,
```

- [ ] **Step 6: Register the IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`.

Add import:

```ts
import { agentPersonasIpcModule } from "../../app-capabilities/agent-personas/main/ipc"
```

Register the module after `quickInputIpcModule`:

```ts
  registry.register(quickInputIpcModule, ctx)
  registry.register(agentPersonasIpcModule, ctx)
```

Add it to `registeredIpcModules` after `quickInputIpcModule`:

```ts
  quickInputIpcModule,
  agentPersonasIpcModule,
```

- [ ] **Step 7: Add bridge types**

Modify `desktop/src/types/bridge.ts`.

Add imports near the quick-input imports:

```ts
import type {
  SynapseAgentPersona,
  SynapseAgentPersonaChangedEvent,
  SynapseAgentPersonaCreateInput,
  SynapseAgentPersonaIdInput,
  SynapseAgentPersonaUpdateInput,
} from "./agent-persona"
```

Add the bridge domain after `quickInput`:

```ts
  agentPersonas: {
    list: () => Promise<SynapseAgentPersona[]>
    create: (input: SynapseAgentPersonaCreateInput) => Promise<SynapseAgentPersona>
    update: (input: SynapseAgentPersonaUpdateInput) => Promise<SynapseAgentPersona>
    delete: (input: SynapseAgentPersonaIdInput) => Promise<void>
    onChanged: (listener: (event: SynapseAgentPersonaChangedEvent) => void) => () => void
  }
```

- [ ] **Step 8: Add the preload bridge domain**

Modify `desktop/electron/preload.ts`.

Add this object after `quickInput` in `synapseBridge`:

```ts
  agentPersonas: {
    list: () => invoke(IPC_CHANNELS.agentPersonas.list)(),
    create: (input) => invoke(IPC_CHANNELS.agentPersonas.create)(input),
    update: (input) => invoke(IPC_CHANNELS.agentPersonas.update)(input),
    delete: (input) => invoke(IPC_CHANNELS.agentPersonas.delete)(input),
    onChanged: createRawPayloadSubscription(
      subscribe,
      IPC_CHANNELS.agentPersonas.changed,
    ),
  },
```

- [ ] **Step 9: Regenerate IPC channels**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: command prints `generated electron/generated/ipc-channels.generated.ts`.

Verify `desktop/electron/generated/ipc-channels.generated.ts` contains:

```ts
  "agentPersonas": {
    "list": "synapse:agent-personas:list",
    "create": "synapse:agent-personas:create",
    "update": "synapse:agent-personas:update",
    "delete": "synapse:agent-personas:delete",
    "changed": "synapse:agent-personas:changed",
  },
```

- [ ] **Step 10: Run IPC-related tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/main/__tests__/ipc.test.ts
pnpm --filter @synapse/desktop exec vitest run electron/runtime/ipc/__tests__/codegen.test.ts
```

Expected: both PASS.

- [ ] **Step 11: Commit Task 3**

```bash
git add \
  desktop/app-capabilities/agent-personas/main/ipc.ts \
  desktop/app-capabilities/agent-personas/main/__tests__/ipc.test.ts \
  desktop/electron/bootstrap/descriptors.ts \
  desktop/electron/bootstrap/registry.ts \
  desktop/electron/bootstrap/index.ts \
  desktop/electron/bootstrap/ipc-registry.ts \
  desktop/electron/preload.ts \
  desktop/electron/generated/ipc-channels.generated.ts \
  desktop/src/types/bridge.ts
git commit -m "feat: expose agent persona ipc"
```

---

### Task 4: System App Registration And Renderer UI

**Files:**
- Create: `desktop/app-capabilities/agent-personas/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/agent-personas/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/agent-personas/renderer/index.tsx`
- Create: `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`
- Modify: `desktop/src/modules/apps/definitions.ts`
- Modify: `desktop/src/modules/apps/components/system-app-content.tsx`
- Modify: `desktop/src/modules/apps/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing app registry assertions**

Modify `desktop/src/modules/apps/__tests__/registry.test.ts`.

In the `lists all system apps in launcher order` expectation, insert `"agent-personas"` after `"agent"`:

```ts
      "agent",
      "agent-personas",
      "workflow",
```

In `exposes stable namespaces and Dock metadata`, add:

```ts
    expect(getSystemAppManifest("agent-personas")).toMatchObject({
      id: "agent-personas",
      namespace: "agent_personas",
      name: "智能体",
      windowTitle: "智能体",
      dock: { pinnedByDefault: false, order: 15 },
      capabilities: {
        primaryMcpPrefix: "app_agent_personas",
      },
    })
```

- [ ] **Step 2: Run the registry test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
```

Expected: FAIL because `agent-personas` is not a known system app id.

- [ ] **Step 3: Write the failing renderer tests**

Create `desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const fixtures = vi.hoisted(() => ({
  items: [
    {
      id: "builtin-zh-en-translator",
      schemaVersion: 1,
      name: "中英翻译",
      description: "在中文和英文之间互译，保留原意、语气和格式。",
      systemPrompt: "你是中英翻译智能体。",
      providerModel: null,
      source: "builtin",
      readonly: true,
    },
    {
      id: "persona-1",
      schemaVersion: 1,
      name: "产品顾问",
      description: "整理产品判断。",
      systemPrompt: "你是产品顾问。",
      providerModel: null,
      source: "user",
      readonly: false,
      createdAt: "2026-06-30T00:00:00.000Z",
      updatedAt: "2026-06-30T00:00:00.000Z",
    },
  ],
}))

const bridge = vi.hoisted(() => ({
  list: vi.fn(async () => fixtures.items),
  create: vi.fn(async (input: { name: string; description: string; systemPrompt: string }) => ({
    id: "persona-2",
    schemaVersion: 1,
    ...input,
    providerModel: null,
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  update: vi.fn(async (input: { id: string; name: string; description: string; systemPrompt: string }) => ({
    schemaVersion: 1,
    ...input,
    providerModel: null,
    source: "user",
    readonly: false,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-06-30T00:00:00.000Z",
  })),
  delete: vi.fn(async () => undefined),
  onChanged: vi.fn(() => vi.fn()),
}))

const toast = vi.hoisted(() => ({
  error: vi.fn(),
  success: vi.fn(),
}))

vi.mock("../../../src/lib/electron-bridge", () => ({
  requireBridgeDomain: (domain: string) => {
    if (domain === "agentPersonas") return bridge
    throw new Error(`Unexpected bridge domain: ${domain}`)
  },
}))

vi.mock("../../../src/app-shell/logging", () => ({
  createRendererLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}))

vi.mock("../../../src/lib/provider-model", () => ({
  useProviderModelLabel: () => "",
}))

vi.mock("sonner", () => ({ toast }))

import { AgentPersonasModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

let roots: Root[] = []

beforeEach(() => {
  bridge.list.mockClear()
  bridge.create.mockClear()
  bridge.update.mockClear()
  bridge.delete.mockClear()
  bridge.onChanged.mockClear()
  toast.error.mockClear()
  toast.success.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("AgentPersonasModule", () => {
  it("loads built-in and user personas", async () => {
    await renderModule()

    expect(bridge.list).toHaveBeenCalled()
    expect(document.body.textContent).toContain("系统内置")
    expect(document.body.textContent).toContain("中英翻译")
    expect(document.body.textContent).toContain("我创建的")
    expect(document.body.textContent).toContain("产品顾问")
  })

  it("does not show edit or delete actions for built-in personas", async () => {
    await renderModule()

    expect(buttonByLabel("查看智能体：中英翻译")).toBeTruthy()
    expect(buttonByLabel("编辑智能体：中英翻译")).toBeFalsy()
    expect(buttonByLabel("删除智能体：中英翻译")).toBeFalsy()
  })

  it("validates required fields before creating a user persona", async () => {
    await renderModule()

    await clickButton("新增")
    await clickButton("保存智能体")

    expect(document.body.textContent).toContain("名称不能为空")
    expect(bridge.create).not.toHaveBeenCalled()
  })
})

async function renderModule() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(<AgentPersonasModule />)
  })
}

async function clickButton(text: string) {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return Array.from(document.body.querySelectorAll("button"))
    .find((button) => button.getAttribute("aria-label") === label) ?? null
}
```

- [ ] **Step 4: Run the renderer test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx
```

Expected: FAIL because `../index` does not exist.

- [ ] **Step 5: Register the system app id and namespace**

Modify `desktop/src/modules/apps/types.ts`.

Insert `"agent-personas"` after `"agent"` in `SYSTEM_APP_IDS`:

```ts
  "agent",
  "agent-personas",
  "workflow",
```

Insert `"agent_personas"` after `"agent"` in `SynapseSystemAppNamespace`:

```ts
  | "agent"
  | "agent_personas"
  | "workflow"
```

- [ ] **Step 6: Add app definition and manifest**

Create `desktop/app-capabilities/agent-personas/renderer/app-definition.ts`:

```ts
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { AGENT_PERSONAS_APP_ID } from "../shared/capability"

export const agentPersonasAppDefinition = {
  id: AGENT_PERSONAS_APP_ID,
  namespace: "agent_personas",
  type: "system",
  name: "智能体",
  windowTitle: "智能体",
  dock: { pinnedByDefault: false, order: 15 },
  window: { openable: true },
  capabilities: {
    primaryMcpPrefix: "app_agent_personas",
  },
  removable: false,
  renameable: false,
  iconEditable: false,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/agent-personas/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import icon from "../../../src/modules/agent/assets/icon.png"
import { agentPersonasAppDefinition } from "./app-definition"

export const agentPersonasAppManifest = {
  ...agentPersonasAppDefinition,
  icon,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 7: Wire the app into registries**

Modify `desktop/src/modules/apps/registry.ts`.

Add import:

```ts
import { agentPersonasAppManifest } from "../../../app-capabilities/agent-personas/renderer/app-manifest"
```

Add it after `agentAppManifest`:

```ts
  agentAppManifest,
  agentPersonasAppManifest,
  workflowAppManifest,
```

Modify `desktop/src/modules/apps/definitions.ts`.

Add import:

```ts
import { agentPersonasAppDefinition } from "../../../app-capabilities/agent-personas/renderer/app-definition"
```

Add it after `agentAppDefinition`:

```ts
  agentAppDefinition,
  agentPersonasAppDefinition,
  workflowAppDefinition,
```

- [ ] **Step 8: Implement the renderer module**

Create `desktop/app-capabilities/agent-personas/renderer/index.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react"
import { CircleAlert, Eye, Pencil, Plus, RefreshCw, Trash2, ChevronDown, X } from "lucide-react"
import { toast } from "sonner"
import { createRendererLogger } from "../../../src/app-shell/logging"
import { Alert, AlertDescription, AlertTitle } from "../../../src/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../../src/components/ui/alert-dialog"
import { Button } from "../../../src/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../src/components/ui/dialog"
import {
  Empty,
  EmptyContent,
  EmptyHeader,
  EmptyTitle,
} from "../../../src/components/ui/empty"
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import { ProviderModelSelectDialog } from "../../../src/components/provider-model-select-dialog"
import { ScrollArea } from "../../../src/components/ui/scroll-area"
import { Skeleton } from "../../../src/components/ui/skeleton"
import { Spinner } from "../../../src/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../../src/components/ui/table"
import { Textarea } from "../../../src/components/ui/textarea"
import { requireBridgeDomain } from "../../../src/lib/electron-bridge"
import { useProviderModelLabel } from "../../../src/lib/provider-model"
import { SystemAppWindowShell } from "../../../src/modules/apps/components/system-app-window-shell"
import type { SynapseAgentPersona } from "../../../src/types/agent-persona"
import type { ProviderModelSelection } from "../../../src/types/provider-model"

const logger = createRendererLogger("agent-personas.app")

type AgentPersonaFormState = {
  readonly mode: "create" | "edit" | "view"
  readonly item: SynapseAgentPersona | null
  readonly name: string
  readonly description: string
  readonly systemPrompt: string
  readonly providerModel: ProviderModelSelection | null
  readonly errors: Partial<Record<"name" | "description" | "systemPrompt" | "form", string>>
}

const emptyFormState: AgentPersonaFormState = {
  mode: "create",
  item: null,
  name: "",
  description: "",
  systemPrompt: "",
  providerModel: null,
  errors: {},
}

export function AgentPersonasModule() {
  const [items, setItems] = useState<SynapseAgentPersona[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [saving, setSaving] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [form, setForm] = useState<AgentPersonaFormState>(emptyFormState)
  const [deleteTarget, setDeleteTarget] = useState<SynapseAgentPersona | null>(null)

  const agentPersonasBridge = useMemo(() => requireBridgeDomain("agentPersonas"), [])

  const reload = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError("")
      setItems(await agentPersonasBridge.list())
    } catch (error) {
      const message = errorMessage(error, "加载失败")
      logger.error("Failed to load agent personas.", error)
      setLoadError(message)
      toast.error(message)
    } finally {
      setLoading(false)
    }
  }, [agentPersonasBridge])

  useEffect(() => {
    void reload()
    return agentPersonasBridge.onChanged((event) => {
      setItems(event.items)
    })
  }, [agentPersonasBridge, reload])

  const builtinItems = items.filter((item) => item.source === "builtin")
  const userItems = items.filter((item) => item.source === "user")

  const openCreateForm = () => {
    setForm(emptyFormState)
    setFormOpen(true)
  }

  const openItem = (item: SynapseAgentPersona, mode: AgentPersonaFormState["mode"]) => {
    setForm({
      mode,
      item,
      name: item.name,
      description: item.description,
      systemPrompt: item.systemPrompt,
      providerModel: item.providerModel,
      errors: {},
    })
    setFormOpen(true)
  }

  const closeForm = () => {
    if (saving) return
    setFormOpen(false)
    setForm(emptyFormState)
    setModelDialogOpen(false)
  }

  const submitForm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (saving || form.mode === "view") return

    const errors = validateForm(form)
    if (Object.keys(errors).length > 0) {
      setForm((current) => ({ ...current, errors }))
      return
    }

    try {
      setSaving(true)
      const input = {
        name: form.name,
        description: form.description,
        systemPrompt: form.systemPrompt,
        providerModel: form.providerModel
          ? { providerId: form.providerModel.providerId, modelTier: form.providerModel.modelTier }
          : null,
      }
      const saved = form.mode === "edit" && form.item
        ? await agentPersonasBridge.update({ id: form.item.id, ...input })
        : await agentPersonasBridge.create(input)

      setItems((current) => mergeItem(current, saved))
      toast.success("已保存")
      closeForm()
    } catch (error) {
      const message = errorMessage(error, "保存失败")
      logger.error("Failed to save agent persona.", error)
      setForm((current) => ({ ...current, errors: { ...current.errors, form: message } }))
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const deleteItem = async () => {
    if (!deleteTarget || deleteTarget.source !== "user") return
    try {
      await agentPersonasBridge.delete({ id: deleteTarget.id })
      setItems((current) => current.filter((entry) => entry.id !== deleteTarget.id))
      setDeleteTarget(null)
    } catch (error) {
      logger.error("Failed to delete agent persona.", error)
      toast.error(errorMessage(error, "删除失败"))
    }
  }

  return (
    <SystemAppWindowShell
      actions={(
        <Button type="button" onClick={openCreateForm}>
          <Plus data-icon="inline-start" />
          新增
        </Button>
      )}
    >
      <ScrollArea className="h-full min-h-0">
        <div className="mx-auto grid w-full max-w-5xl gap-5 p-3 sm:p-5">
          {loading ? (
            <AgentPersonaSkeleton />
          ) : items.length === 0 && loadError ? (
            <Alert variant="destructive">
              <CircleAlert />
              <AlertTitle>加载失败</AlertTitle>
              <AlertDescription className="break-words">{loadError}</AlertDescription>
              <Button type="button" variant="outline" size="sm" className="mt-2 w-fit" onClick={() => void reload()}>
                <RefreshCw data-icon="inline-start" />
                重试
              </Button>
            </Alert>
          ) : (
            <>
              <AgentPersonaSection title="系统内置">
                <AgentPersonaTable
                  items={builtinItems}
                  onView={(item) => openItem(item, "view")}
                  onEdit={(item) => openItem(item, "edit")}
                  onDelete={setDeleteTarget}
                />
              </AgentPersonaSection>
              <AgentPersonaSection title="我创建的">
                {userItems.length === 0 ? (
                  <Empty className="min-h-44 border">
                    <EmptyHeader>
                      <EmptyTitle>暂无智能体</EmptyTitle>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button type="button" variant="outline" onClick={openCreateForm}>新增智能体</Button>
                    </EmptyContent>
                  </Empty>
                ) : (
                  <AgentPersonaTable
                    items={userItems}
                    onView={(item) => openItem(item, "view")}
                    onEdit={(item) => openItem(item, "edit")}
                    onDelete={setDeleteTarget}
                  />
                )}
              </AgentPersonaSection>
            </>
          )}
        </div>
      </ScrollArea>
      <AgentPersonaDialog
        form={form}
        open={formOpen}
        saving={saving}
        modelDialogOpen={modelDialogOpen}
        onModelDialogOpenChange={setModelDialogOpen}
        onFormChange={setForm}
        onOpenChange={(open) => {
          if (open) setFormOpen(true)
          else closeForm()
        }}
        onSubmit={submitForm}
      />
      <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => {
        if (!open) setDeleteTarget(null)
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除智能体</AlertDialogTitle>
            <AlertDialogDescription>
              删除后不可恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void deleteItem()}>删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </SystemAppWindowShell>
  )
}

function AgentPersonaSection({ children, title }: { readonly children: ReactNode; readonly title: string }) {
  return (
    <section className="grid gap-2">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function AgentPersonaSkeleton() {
  return (
    <div className="grid gap-5">
      {Array.from({ length: 2 }).map((_, sectionIndex) => (
        <div key={sectionIndex} className="grid gap-2">
          <Skeleton className="h-4 w-20" />
          <div className="rounded-md border bg-background p-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-3 h-4 w-full max-w-xl" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AgentPersonaTable({
  items,
  onDelete,
  onEdit,
  onView,
}: {
  readonly items: SynapseAgentPersona[]
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly onView: (item: SynapseAgentPersona) => void
}) {
  return (
    <div className="rounded-md border bg-background">
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-44">名称</TableHead>
            <TableHead>简介</TableHead>
            <TableHead className="w-40">模型</TableHead>
            <TableHead className="w-28 text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <AgentPersonaRow
              key={item.id}
              item={item}
              onDelete={onDelete}
              onEdit={onEdit}
              onView={onView}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function AgentPersonaRow({
  item,
  onDelete,
  onEdit,
  onView,
}: {
  readonly item: SynapseAgentPersona
  readonly onDelete: (item: SynapseAgentPersona) => void
  readonly onEdit: (item: SynapseAgentPersona) => void
  readonly onView: (item: SynapseAgentPersona) => void
}) {
  const modelLabel = useProviderModelLabel(item.providerModel)
  return (
    <TableRow>
      <TableCell className="min-w-0 align-top font-medium">
        <span className="block truncate">{item.name}</span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block truncate text-muted-foreground">{item.description}</span>
      </TableCell>
      <TableCell className="min-w-0 align-top">
        <span className="block truncate text-muted-foreground">
          {item.providerModel ? modelLabel || item.providerModel.providerId : "未指定"}
        </span>
      </TableCell>
      <TableCell className="align-top text-right">
        <div className="flex justify-end gap-1">
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`查看智能体：${item.name}`} onClick={() => onView(item)}>
            <Eye className="size-3.5" />
          </Button>
          {item.source === "user" ? (
            <>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`编辑智能体：${item.name}`} onClick={() => onEdit(item)}>
                <Pencil className="size-3.5" />
              </Button>
              <Button type="button" variant="ghost" size="icon-xs" aria-label={`删除智能体：${item.name}`} onClick={() => onDelete(item)}>
                <Trash2 className="size-3.5" />
              </Button>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  )
}

function AgentPersonaDialog({
  form,
  modelDialogOpen,
  onFormChange,
  onModelDialogOpenChange,
  onOpenChange,
  onSubmit,
  open,
  saving,
}: {
  readonly form: AgentPersonaFormState
  readonly modelDialogOpen: boolean
  readonly onFormChange: React.Dispatch<React.SetStateAction<AgentPersonaFormState>>
  readonly onModelDialogOpenChange: (open: boolean) => void
  readonly onOpenChange: (open: boolean) => void
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void
  readonly open: boolean
  readonly saving: boolean
}) {
  const readonly = form.mode === "view"
  const title = form.mode === "edit" ? "编辑智能体" : form.mode === "view" ? "查看智能体" : "新增智能体"
  const modelLabel = useProviderModelLabel(form.providerModel)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form className="grid gap-4" onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription className="sr-only">管理智能体基础配置。</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={Boolean(form.errors.name) || undefined}>
              <FieldLabel htmlFor="agent-persona-name">名称</FieldLabel>
              <FieldContent>
                <Input
                  id="agent-persona-name"
                  value={form.name}
                  disabled={saving || readonly}
                  aria-invalid={Boolean(form.errors.name)}
                  onChange={(event) => onFormChange((current) => ({
                    ...current,
                    name: event.target.value,
                    errors: { ...current.errors, name: undefined, form: undefined },
                  }))}
                  autoFocus={!readonly}
                />
                {form.errors.name ? <FieldError>{form.errors.name}</FieldError> : null}
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(form.errors.description) || undefined}>
              <FieldLabel htmlFor="agent-persona-description">简介</FieldLabel>
              <FieldContent>
                <Input
                  id="agent-persona-description"
                  value={form.description}
                  disabled={saving || readonly}
                  aria-invalid={Boolean(form.errors.description)}
                  onChange={(event) => onFormChange((current) => ({
                    ...current,
                    description: event.target.value,
                    errors: { ...current.errors, description: undefined, form: undefined },
                  }))}
                />
                {form.errors.description ? <FieldError>{form.errors.description}</FieldError> : null}
              </FieldContent>
            </Field>
            <Field data-invalid={Boolean(form.errors.systemPrompt) || undefined}>
              <FieldLabel htmlFor="agent-persona-system-prompt">系统提示词</FieldLabel>
              <FieldContent>
                <Textarea
                  id="agent-persona-system-prompt"
                  value={form.systemPrompt}
                  disabled={saving || readonly}
                  className="min-h-40 resize-y"
                  aria-invalid={Boolean(form.errors.systemPrompt)}
                  onChange={(event) => onFormChange((current) => ({
                    ...current,
                    systemPrompt: event.target.value,
                    errors: { ...current.errors, systemPrompt: undefined, form: undefined },
                  }))}
                />
                {form.errors.systemPrompt ? <FieldError>{form.errors.systemPrompt}</FieldError> : null}
              </FieldContent>
            </Field>
            <Field>
              <FieldLabel>模型</FieldLabel>
              <FieldContent>
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="min-w-0 flex-1 justify-between"
                    disabled={saving || readonly}
                    onClick={() => onModelDialogOpenChange(true)}
                  >
                    <span className="truncate text-muted-foreground">
                      {form.providerModel ? modelLabel || form.providerModel.providerId : "未指定"}
                    </span>
                    <ChevronDown data-icon="inline-end" />
                  </Button>
                  {form.providerModel && !readonly ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      aria-label="清除模型"
                      disabled={saving}
                      onClick={() => onFormChange((current) => ({ ...current, providerModel: null }))}
                    >
                      <X className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </FieldContent>
            </Field>
            {form.errors.form ? <FieldError>{form.errors.form}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {readonly ? "关闭" : "取消"}
            </Button>
            {!readonly ? (
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                {saving ? "保存中" : "保存智能体"}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
        <ProviderModelSelectDialog
          open={modelDialogOpen}
          onOpenChange={onModelDialogOpenChange}
          defaultSelection={form.providerModel ?? undefined}
          onSelect={(selection) => onFormChange((current) => ({ ...current, providerModel: selection }))}
        />
      </DialogContent>
    </Dialog>
  )
}

function validateForm(form: AgentPersonaFormState): AgentPersonaFormState["errors"] {
  const errors: AgentPersonaFormState["errors"] = {}
  if (!form.name.trim()) errors.name = "名称不能为空"
  if (!form.description.trim()) errors.description = "简介不能为空"
  if (!form.systemPrompt.trim()) errors.systemPrompt = "系统提示词不能为空"
  return errors
}

function mergeItem(items: SynapseAgentPersona[], item: SynapseAgentPersona): SynapseAgentPersona[] {
  const next = items.some((entry) => entry.id === item.id)
    ? items.map((entry) => entry.id === item.id ? item : entry)
    : [...items, item]
  return [
    ...next.filter((entry) => entry.source === "builtin"),
    ...next.filter((entry) => entry.source === "user"),
  ]
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message
  return fallback
}
```

- [ ] **Step 9: Render the app from SystemAppContent**

Modify `desktop/src/modules/apps/components/system-app-content.tsx`.

Add import:

```ts
import { AgentPersonasModule } from "../../../../app-capabilities/agent-personas/renderer"
```

Add branch after the existing `agent` branch:

```tsx
  if (appId === "agent-personas") return <AgentPersonasModule />
```

- [ ] **Step 10: Run renderer and registry tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/apps/__tests__/registry.test.ts
pnpm --filter @synapse/desktop exec vitest run app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx
```

Expected: both PASS.

- [ ] **Step 11: Commit Task 4**

```bash
git add \
  desktop/app-capabilities/agent-personas/renderer/app-definition.ts \
  desktop/app-capabilities/agent-personas/renderer/app-manifest.ts \
  desktop/app-capabilities/agent-personas/renderer/index.tsx \
  desktop/app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx \
  desktop/src/modules/apps/types.ts \
  desktop/src/modules/apps/registry.ts \
  desktop/src/modules/apps/definitions.ts \
  desktop/src/modules/apps/components/system-app-content.tsx \
  desktop/src/modules/apps/__tests__/registry.test.ts
git commit -m "feat: add agent personas app UI"
```

---

### Task 5: Release Notes And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add the release note**

Modify `RELEASE_NOTES_PENDING.md`.

Add this bullet under `## 新增功能`:

```md
- 新增“智能体”系统应用，可以查看内置“中英翻译”智能体，并管理自己创建的智能体名称、简介、系统提示词和可选模型；当前版本只做配置管理，不会改变对话运行方式。
```

- [ ] **Step 2: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  electron/runtime/data-repo/__tests__/agent-personas-schema.test.ts \
  app-capabilities/agent-personas/main/__tests__/service.test.ts \
  app-capabilities/agent-personas/main/__tests__/ipc.test.ts \
  app-capabilities/agent-personas/renderer/__tests__/agent-personas-module.test.tsx \
  src/modules/apps/__tests__/registry.test.ts \
  electron/runtime/ipc/__tests__/codegen.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run IPC codegen check**

Run:

```bash
pnpm --filter @synapse/desktop run check:ipc-codegen
```

Expected: PASS. If the script name is absent in `desktop/package.json`, run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
git diff --exit-code -- desktop/electron/generated/ipc-channels.generated.ts
```

Expected: no diff.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git diff --stat
git diff -- RELEASE_NOTES_PENDING.md
```

Expected: diff includes the new app files, app registration, bridge wiring, tests, generated IPC channels, and one release note bullet.

- [ ] **Step 6: Commit Task 5**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent personas app"
```

---

## Self-Review Checklist

- Spec coverage: The plan creates an independent “智能体” system app, DataRepository storage for user personas, fixed built-in “中英翻译”, read-only built-in behavior, user CRUD, required fields, optional model selection, IPC, bridge, registry, tests, and release notes.
- Scope control: The plan does not modify Agent runtime, does not add discovery, avatars, enabled state, sorting UI, copying, tags, or conversation entry points.
- Type consistency: Public names use `AgentPersona` in shared code, `SynapseAgentPersona` in renderer bridge types, `agentPersonas` for bridge domain, `agent-personas` for system app id, and `app.agent-personas.items` for DataRepository namespace.
- Verification: Focused Vitest, typecheck, and IPC codegen checks are included.
