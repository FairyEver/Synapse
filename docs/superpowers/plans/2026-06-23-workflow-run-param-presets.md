# Workflow Run Parameter Presets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workflow-scoped run parameter presets and improve the workflow run parameter dialog layout.

**Architecture:** Store parameter presets in a separate DataRepository namespace so they stay local and do not become part of workflow export/import. Expose preset CRUD through the existing workflow IPC module and a dedicated preload bridge domain. Keep all run-parameter UI behavior inside the shared `RunParamsDialog` so the workflow list and editor run button get the same behavior.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vitest, zod, DataRepository, shadcn/Radix UI, Tailwind token classes.

---

## File Structure

- Create `desktop/electron/services/workflow/workflow-param-preset-service.ts`
  - Owns workflow parameter preset CRUD, duplicate-name checks, workflow-scoped listing, and workflow cleanup.
- Create `desktop/electron/services/__tests__/workflow-param-preset-service.test.ts`
  - Verifies service behavior without renderer or IPC.
- Modify `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
  - Adds `WorkflowParamPresetEntryV1` and `workflowParamPresetsSchema`.
- Modify `desktop/electron/runtime/data-repo/schemas/index.ts`
  - Exports and registers `workflowParamPresetsSchema`.
- Modify `desktop/electron/runtime/data-repo/index.ts`
  - Exports `WorkflowParamPresetEntryV1`.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Registers `core.workflow.param-presets` and passes it to `WorkflowService` for delete cleanup.
- Modify `desktop/electron/services/workflow/workflow-service.ts`
  - Calls preset cleanup after deleting a workflow.
- Modify `desktop/electron/modules/workflow/ipc.ts`
  - Adds zod schemas and IPC methods for preset list/save/delete.
- Modify `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
  - Verifies IPC request validation, duplicate handling, and log redaction.
- Modify `desktop/electron/preload.ts`
  - Adds IPC channels and `window.synapse.workflowParamPresets`.
- Modify `desktop/electron/generated/ipc-channels.generated.ts`
  - Regenerate with `pnpm --filter @synapse/desktop run generate:ipc`.
- Modify `desktop/src/types/workflow.ts`
  - Adds renderer/shared preset types.
- Modify `desktop/src/types/bridge.ts`
  - Adds bridge type for `workflowParamPresets`.
- Modify `desktop/src/modules/workflow/components/run-params-dialog.tsx`
  - Adds wider layout, preset select, save-name dialog, overwrite confirmation, delete confirmation, and safe tracking.
- Modify `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`
  - Adds UI behavior tests.
- Modify `desktop/src/modules/workflow/components/workflow-list.tsx`
  - Passes `workflowId` into `RunParamsDialog`.
- Modify `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx`
  - Passes `definition.id` into `RunParamsDialog`.
- Modify `RELEASE_NOTES_PENDING.md`
  - Adds a user-facing note for run parameter presets and dialog layout.

---

### Task 1: Data Model And Preset Service

**Files:**
- Create: `desktop/electron/services/workflow/workflow-param-preset-service.ts`
- Create: `desktop/electron/services/__tests__/workflow-param-preset-service.test.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/placeholders.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Modify: `desktop/electron/runtime/data-repo/index.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/services/workflow/workflow-service.ts`
- Test: `desktop/electron/services/__tests__/workflow-param-preset-service.test.ts`
- Test: `desktop/electron/services/__tests__/workflow-service.test.ts`

- [ ] **Step 1: Write the failing preset service tests**

Add this file at `desktop/electron/services/__tests__/workflow-param-preset-service.test.ts`:

```ts
import { mkdtempSync, rmSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("../log-store", () => ({
  createMainLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}))

import {
  DataRepositoryImpl,
  JsonNamespace,
  workflowParamPresetsSchema,
  type WorkflowParamPresetEntryV1,
} from "../../runtime/data-repo"
import { WorkflowParamPresetService } from "../workflow/workflow-param-preset-service"

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function createService(): WorkflowParamPresetService {
  const dir = mkdtempSync(path.join(os.tmpdir(), "wf-param-presets-"))
  roots.push(dir)
  const repo = new DataRepositoryImpl()
  repo.register(workflowParamPresetsSchema, new JsonNamespace({
    name: workflowParamPresetsSchema.name,
    schemaVersion: workflowParamPresetsSchema.currentVersion,
    backend: "json",
    filePath: path.join(dir, "workflow.param-presets.json"),
    validate: workflowParamPresetsSchema.validate,
  }))
  return new WorkflowParamPresetService(repo)
}

describe("WorkflowParamPresetService", () => {
  it("lists presets by workflowId and keeps workflows isolated", async () => {
    const service = createService()
    await service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } })
    await service.save({ workflowId: "workflow-b", name: "课程标题", values: { topic: "B" } })

    expect(await service.list("workflow-a")).toEqual([
      expect.objectContaining({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } }),
    ])
    expect(await service.list("workflow-b")).toEqual([
      expect.objectContaining({ workflowId: "workflow-b", name: "课程标题", values: { topic: "B" } }),
    ])
  })

  it("rejects duplicate names in one workflow unless overwritePresetId is supplied", async () => {
    const service = createService()
    const first = await service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "A" } })

    await expect(
      service.save({ workflowId: "workflow-a", name: "课程标题", values: { topic: "B" } }),
    ).rejects.toThrow("Preset name already exists")

    const overwritten = await service.save({
      workflowId: "workflow-a",
      name: "课程标题",
      values: { topic: "B" },
      overwritePresetId: first.id,
    })

    expect(overwritten.id).toBe(first.id)
    expect(overwritten.values).toEqual({ topic: "B" })
    expect(overwritten.updatedAt).toBeGreaterThanOrEqual(first.updatedAt)
  })

  it("trims names, rejects empty names, deletes presets, and removes a workflow's presets", async () => {
    const service = createService()
    await expect(service.save({ workflowId: "workflow-a", name: "   ", values: {} }))
      .rejects.toThrow("Preset name is required")

    const first = await service.save({ workflowId: "workflow-a", name: "  A  ", values: { text: "one" } })
    const second = await service.save({ workflowId: "workflow-a", name: "B", values: { text: "two" } })
    expect(first.name).toBe("A")

    await service.delete(second.id)
    expect((await service.list("workflow-a")).map((preset) => preset.id)).toEqual([first.id])

    await service.deleteForWorkflow("workflow-a")
    expect(await service.list("workflow-a")).toEqual([])
  })

  it("normalizes invalid stored values out of the namespace", () => {
    const valid: WorkflowParamPresetEntryV1 = {
      id: "preset-1",
      schemaVersion: 1,
      workflowId: "workflow-a",
      name: "A",
      values: { topic: "value" },
      createdAt: 1,
      updatedAt: 1,
    }

    expect(workflowParamPresetsSchema.validate(valid)).toBe(true)
    expect(workflowParamPresetsSchema.validate({ ...valid, values: { count: 1 } })).toBe(false)
    expect(workflowParamPresetsSchema.validate({ ...valid, workflowId: "" })).toBe(false)
  })
})
```

- [ ] **Step 2: Run preset service tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-param-preset-service.test.ts
```

Expected: FAIL with missing exports for `workflowParamPresetsSchema` and missing module `workflow-param-preset-service`.

- [ ] **Step 3: Add DataRepository schema**

In `desktop/electron/runtime/data-repo/schemas/placeholders.ts`, add this near the workflow schema block, before `WorkflowEntryV1`:

```ts
export interface WorkflowParamPresetEntryV1 extends Record<string, unknown> {
  id: string
  schemaVersion: 1
  workflowId: string
  name: string
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}

export const workflowParamPresetsSchema: NamespaceSchema<WorkflowParamPresetEntryV1> = {
  name: "workflow.param-presets",
  backend: "json",
  currentVersion: 1,
  migrations: noMigrations,
  validate: (v): v is WorkflowParamPresetEntryV1 =>
    isAnyRecord<WorkflowParamPresetEntryV1>(v)
    && (v as WorkflowParamPresetEntryV1).schemaVersion === 1
    && typeof (v as WorkflowParamPresetEntryV1).id === "string"
    && (v as WorkflowParamPresetEntryV1).id.length > 0
    && typeof (v as WorkflowParamPresetEntryV1).workflowId === "string"
    && (v as WorkflowParamPresetEntryV1).workflowId.length > 0
    && typeof (v as WorkflowParamPresetEntryV1).name === "string"
    && (v as WorkflowParamPresetEntryV1).name.length > 0
    && isStringRecord((v as WorkflowParamPresetEntryV1).values)
    && typeof (v as WorkflowParamPresetEntryV1).createdAt === "number"
    && typeof (v as WorkflowParamPresetEntryV1).updatedAt === "number",
}
```

In `desktop/electron/runtime/data-repo/schemas/index.ts`, add `workflowParamPresetsSchema` and `type WorkflowParamPresetEntryV1` to the export from `./placeholders`, add `workflowParamPresetsSchema` to the local import from `./placeholders`, and place it in `allSchemas` immediately before `workflowsSchema`:

```ts
workflowParamPresetsSchema,
workflowsSchema,
```

In `desktop/electron/runtime/data-repo/index.ts`, export the new schema and type from the schema barrel:

```ts
workflowParamPresetsSchema,
type WorkflowParamPresetEntryV1,
```

- [ ] **Step 4: Add the preset service implementation**

Create `desktop/electron/services/workflow/workflow-param-preset-service.ts`:

```ts
import { randomUUID } from "node:crypto"
import type { DataNamespace, DataRepository, WorkflowParamPresetEntryV1 } from "../../runtime/data-repo"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow-param-presets")

export interface WorkflowParamPreset {
  readonly id: string
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, string>
  readonly createdAt: number
  readonly updatedAt: number
}

export interface SaveWorkflowParamPresetInput {
  readonly workflowId: string
  readonly name: string
  readonly values: Record<string, string>
  readonly overwritePresetId?: string
}

export class WorkflowParamPresetService {
  private readonly presets: DataNamespace<WorkflowParamPresetEntryV1>

  constructor(dataRepository: DataRepository) {
    this.presets = dataRepository.namespace<WorkflowParamPresetEntryV1>("workflow.param-presets")
  }

  async list(workflowId: string): Promise<WorkflowParamPreset[]> {
    const items = await this.presets.list()
    return items
      .filter((preset) => preset.workflowId === workflowId)
      .sort((left, right) => right.updatedAt - left.updatedAt || left.name.localeCompare(right.name))
      .map(toPublicPreset)
  }

  async save(input: SaveWorkflowParamPresetInput): Promise<WorkflowParamPreset> {
    const workflowId = input.workflowId.trim()
    const name = input.name.trim()
    if (!workflowId) throw new Error("Workflow id is required")
    if (!name) throw new Error("Preset name is required")

    const now = Date.now()
    const existing = (await this.presets.list()).filter((preset) => preset.workflowId === workflowId)
    const duplicate = existing.find((preset) => preset.name === name)
    if (duplicate && duplicate.id !== input.overwritePresetId) {
      throw new Error("Preset name already exists")
    }

    const previous = input.overwritePresetId
      ? existing.find((preset) => preset.id === input.overwritePresetId)
      : null
    const id = previous?.id ?? randomUUID()
    const createdAt = previous?.createdAt ?? now
    const entry: WorkflowParamPresetEntryV1 = {
      id,
      schemaVersion: 1,
      workflowId,
      name,
      values: { ...input.values },
      createdAt,
      updatedAt: now,
    }
    await this.presets.upsert(entry)
    logger.info("workflow param preset saved", {
      workflowId,
      presetId: id,
      valueKeyCount: Object.keys(input.values).length,
      overwritten: Boolean(previous),
    })
    return toPublicPreset(entry)
  }

  async delete(id: string): Promise<void> {
    await this.presets.remove(id)
    logger.info("workflow param preset deleted", { presetId: id })
  }

  async deleteForWorkflow(workflowId: string): Promise<void> {
    const items = await this.presets.list()
    const targets = items.filter((preset) => preset.workflowId === workflowId)
    for (const preset of targets) {
      await this.presets.remove(preset.id)
    }
    logger.info("workflow param presets deleted for workflow", { workflowId, count: targets.length })
  }
}

function toPublicPreset(entry: WorkflowParamPresetEntryV1): WorkflowParamPreset {
  return {
    id: entry.id,
    workflowId: entry.workflowId,
    name: entry.name,
    values: { ...entry.values },
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  }
}
```

- [ ] **Step 5: Wire workflow deletion cleanup**

Modify `desktop/electron/services/workflow/workflow-service.ts`.

Update imports:

```ts
import type { WorkflowParamPresetService } from "./workflow-param-preset-service"
```

Add a field and constructor parameter:

```ts
  private readonly paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">

  constructor(
    dataRepository: DataRepository,
    validationOptionsProvider?: WorkflowValidationOptionsProvider,
    paramPresetService?: Pick<WorkflowParamPresetService, "deleteForWorkflow">,
  ) {
    this.workflowsNamespace = dataRepository.namespace<WorkflowEntryV1>("workflows")
    this.validationOptionsProvider = validationOptionsProvider
    this.paramPresetService = paramPresetService
  }
```

In `delete(id: string)`, after `await this.workflowsNamespace.remove(id)`, add:

```ts
      await this.paramPresetService?.deleteForWorkflow(id)
```

Modify `desktop/electron/bootstrap/descriptors.ts`.

Add import:

```ts
import { WorkflowParamPresetService } from "../services/workflow/workflow-param-preset-service"
```

Add descriptor before `coreWorkflowServiceDescriptor`:

```ts
export const coreWorkflowParamPresetServiceDescriptor: ServiceDescriptor<WorkflowParamPresetService> = {
  id: "core.workflow.param-presets",
  criticality: "degraded",
  dependsOn: ["core.data-repository"],
  create(ctx) {
    return new WorkflowParamPresetService(ctx.registry.get<DataRepository>("core.data-repository"))
  },
}
```

Update `coreWorkflowServiceDescriptor`:

```ts
  dependsOn: ["core.data-repository", "core.workflow.param-presets"],
  create(ctx) {
    const dataRepo = ctx.registry.get<DataRepository>("core.data-repository")
    return new WorkflowService(dataRepo, async () => ({
      configuredProjectIds: configuredWorkflowProjectIdsFromConfig(await configStore.load()),
    }), ctx.registry.get<WorkflowParamPresetService>("core.workflow.param-presets"))
  },
```

Register the new descriptor in `desktop/electron/bootstrap/registry.ts` next to `coreWorkflowServiceDescriptor`:

```ts
registry.register(coreWorkflowParamPresetServiceDescriptor)
```

- [ ] **Step 6: Add workflow deletion cleanup test**

In `desktop/electron/services/__tests__/workflow-service.test.ts`, add this test inside `describe("WorkflowService", () => { ... })`:

```ts
  it("cleans workflow parameter presets when deleting a workflow", async () => {
    const { repo, svc } = createRepo()
    const cleanup = { deleteForWorkflow: vi.fn(async () => undefined) }
    const withCleanup = new WorkflowService(repo, undefined, cleanup)
    const def = makeDef()

    await svc.save(def)
    await withCleanup.delete(def.id)

    expect(cleanup.deleteForWorkflow).toHaveBeenCalledWith(def.id)
  })
```

- [ ] **Step 7: Run service tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/__tests__/workflow-param-preset-service.test.ts desktop/electron/services/__tests__/workflow-service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 1**

```bash
git add desktop/electron/runtime/data-repo desktop/electron/services/workflow desktop/electron/services/__tests__/workflow-param-preset-service.test.ts desktop/electron/services/__tests__/workflow-service.test.ts desktop/electron/bootstrap
git commit -m "feat: store workflow run parameter presets"
```

---

### Task 2: IPC, Preload Bridge, And Shared Types

**Files:**
- Modify: `desktop/src/types/workflow.ts`
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Test: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`

- [ ] **Step 1: Add shared renderer types**

In `desktop/src/types/workflow.ts`, add:

```ts
export interface WorkflowParamPreset {
  id: string
  workflowId: string
  name: string
  values: Record<string, string>
  createdAt: number
  updatedAt: number
}

export interface SaveWorkflowParamPresetInput {
  workflowId: string
  name: string
  values: Record<string, string>
  overwritePresetId?: string
}
```

In `desktop/src/types/bridge.ts`, update the workflow type imports if needed and add this bridge domain next to `workflow`:

```ts
  workflowParamPresets: {
    list: (workflowId: string) => Promise<WorkflowParamPreset[]>
    save: (input: SaveWorkflowParamPresetInput) => Promise<WorkflowParamPreset>
    delete: (id: string) => Promise<void>
  }
```

- [ ] **Step 2: Write failing IPC tests**

In `desktop/electron/modules/workflow/__tests__/ipc.test.ts`, add this test near other IPC method tests:

```ts
  it("exposes workflow parameter preset IPC without logging values", async () => {
    const presets = {
      list: vi.fn(async () => [{ id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret text" }, createdAt: 1, updatedAt: 2 }]),
      save: vi.fn(async (input: unknown) => ({ id: "preset-2", workflowId: "workflow-1", name: "新预设", values: (input as { values: Record<string, string> }).values, createdAt: 3, updatedAt: 3 })),
      delete: vi.fn(async () => undefined),
    }
    const harness = createInMemoryHarness()
    const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
      if (serviceId === "core.workflow.param-presets") return presets as T
      throw new Error(`Unknown service: ${serviceId}`)
    }
    harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

    await expect(harness.invoke("synapse:workflow:param-presets:list", { workflowId: "workflow-1" }))
      .resolves.toEqual([expect.objectContaining({ id: "preset-1", values: { topic: "secret text" } })])
    await expect(harness.invoke("synapse:workflow:param-presets:save", {
      workflowId: "workflow-1",
      name: "新预设",
      values: { topic: "secret text" },
    })).resolves.toEqual(expect.objectContaining({ id: "preset-2" }))
    await expect(harness.invoke("synapse:workflow:param-presets:delete", { id: "preset-2" }))
      .resolves.toBeUndefined()

    expect(presets.list).toHaveBeenCalledWith("workflow-1")
    expect(presets.save).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "新预设", values: { topic: "secret text" } })
    expect(presets.delete).toHaveBeenCalledWith("preset-2")
    expect(JSON.stringify(logStoreMock.logger.info.mock.calls)).not.toContain("secret text")
    expect(JSON.stringify(logStoreMock.logger.warn.mock.calls)).not.toContain("secret text")
  })
```

- [ ] **Step 3: Run IPC test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts --testNamePattern "workflow parameter preset IPC"
```

Expected: FAIL because the three channels are not registered.

- [ ] **Step 4: Implement IPC methods**

In `desktop/electron/modules/workflow/ipc.ts`, add import:

```ts
import type { WorkflowParamPresetService } from "../../services/workflow/workflow-param-preset-service"
```

Add schemas near other workflow zod schemas:

```ts
const workflowParamPresetSchema = z.object({
  id: z.string(),
  workflowId: workflowIdSchema,
  name: z.string(),
  values: z.record(z.string(), z.string()),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const saveWorkflowParamPresetSchema = z.object({
  workflowId: workflowIdSchema,
  name: z.string(),
  values: z.record(z.string(), z.string()),
  overwritePresetId: z.string().optional(),
})
```

Add methods inside `workflowIpcModule.methods`:

```ts
    paramPresetsList: {
      channel: "synapse:workflow:param-presets:list", kind: "invoke",
      request: z.object({ workflowId: workflowIdSchema }),
      response: z.array(workflowParamPresetSchema),
      handler: async (ctx, { workflowId }: { workflowId: string }) => {
        logger.info("workflow:paramPresets:list", { workflowId })
        return ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").list(workflowId)
      },
    },
    paramPresetsSave: {
      channel: "synapse:workflow:param-presets:save", kind: "invoke",
      request: saveWorkflowParamPresetSchema,
      response: workflowParamPresetSchema,
      handler: async (ctx, input: z.infer<typeof saveWorkflowParamPresetSchema>) => {
        logger.info("workflow:paramPresets:save", {
          workflowId: input.workflowId,
          nameLength: input.name.length,
          valueKeyCount: Object.keys(input.values).length,
          overwrite: Boolean(input.overwritePresetId),
        })
        return ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").save(input)
      },
    },
    paramPresetsDelete: {
      channel: "synapse:workflow:param-presets:delete", kind: "invoke",
      request: z.object({ id: z.string() }),
      response: z.void(),
      handler: async (ctx, { id }: { id: string }) => {
        logger.info("workflow:paramPresets:delete", { presetId: id })
        await ctx.resolve<WorkflowParamPresetService>("core.workflow.param-presets").delete(id)
      },
    },
```

- [ ] **Step 5: Add preload bridge**

In `desktop/electron/preload.ts`, add channels in `IPC_CHANNELS.workflow`:

```ts
    "paramPresetsList": "synapse:workflow:param-presets:list",
    "paramPresetsSave": "synapse:workflow:param-presets:save",
    "paramPresetsDelete": "synapse:workflow:param-presets:delete",
```

Add the bridge domain near `workflow`:

```ts
  workflowParamPresets: {
    list: (workflowId: string) => invoke(IPC_CHANNELS.workflow.paramPresetsList)({ workflowId }),
    save: (input) => invoke(IPC_CHANNELS.workflow.paramPresetsSave)(input),
    delete: (id: string) => invoke(IPC_CHANNELS.workflow.paramPresetsDelete)({ id }),
  },
```

- [ ] **Step 6: Regenerate IPC channel metadata**

Run:

```bash
pnpm --filter @synapse/desktop run generate:ipc
```

Expected: `desktop/electron/generated/ipc-channels.generated.ts` contains:

```ts
"paramPresetsList": "synapse:workflow:param-presets:list"
"paramPresetsSave": "synapse:workflow:param-presets:save"
"paramPresetsDelete": "synapse:workflow:param-presets:delete"
```

- [ ] **Step 7: Update preload tests**

In `desktop/electron/__tests__/preload.test.ts`, add expectations beside existing workflow channel tests:

```ts
expect(serializedLog).toContain("synapse:workflow:param-presets:list")
expect(serializedLog).toContain("synapse:workflow:param-presets:save")
expect(serializedLog).toContain("synapse:workflow:param-presets:delete")
```

Add bridge-call coverage in the preload bridge test section:

```ts
await bridge.workflowParamPresets.list("workflow-1")
await bridge.workflowParamPresets.save({ workflowId: "workflow-1", name: "A", values: { topic: "secret" } })
await bridge.workflowParamPresets.delete("preset-1")
```

Assert the invoked channel names match the three new channels:

```ts
expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:workflow:param-presets:list", { workflowId: "workflow-1" })
expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:workflow:param-presets:save", { workflowId: "workflow-1", name: "A", values: { topic: "secret" } })
expect(electronMock.ipcRenderer.invoke).toHaveBeenCalledWith("synapse:workflow:param-presets:delete", { id: "preset-1" })
```

- [ ] **Step 8: Run IPC and preload tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 2**

```bash
git add desktop/src/types/workflow.ts desktop/src/types/bridge.ts desktop/electron/modules/workflow/ipc.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/electron/__tests__/preload.test.ts
git commit -m "feat: expose workflow parameter preset bridge"
```

---

### Task 3: Run Parameter Dialog Behavior Tests

**Files:**
- Modify: `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`

- [ ] **Step 1: Add bridge mocks and helpers**

In `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`, extend `mocks`:

```ts
const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  presetList: vi.fn(),
  presetSave: vi.fn(),
  presetDelete: vi.fn(),
}))
```

Add a helper before `describe`:

```ts
function installBridge() {
  ;(window as unknown as { synapse: unknown }).synapse = {
    workflowParamPresets: {
      list: mocks.presetList,
      save: mocks.presetSave,
      delete: mocks.presetDelete,
    },
  }
}

async function renderDialog(props: Partial<React.ComponentProps<typeof RunParamsDialog>> = {}) {
  installBridge()
  mocks.presetList.mockResolvedValue([])
  const onConfirm = vi.fn(async () => undefined)
  const onCancel = vi.fn()
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <RunParamsDialog
        open
        workflowId="workflow-1"
        params={[
          { name: "topic", type: "text", default: "" },
          { name: "count", type: "number", default: 3 },
        ]}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    )
  })
  await act(async () => {
    await Promise.resolve()
  })
  return { onConfirm, onCancel }
}
```

Update `afterEach` to remove the bridge:

```ts
delete (window as unknown as { synapse?: unknown }).synapse
```

- [ ] **Step 2: Add failing behavior tests**

Add these tests:

```ts
  it("loads workflow-scoped presets and applies a selected preset", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret preset", count: "9", stale: "ignored" }, createdAt: 1, updatedAt: 2 },
    ])
    await renderDialog()

    expect(mocks.presetList).toHaveBeenCalledWith("workflow-1")
    document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    await act(async () => {
      document.body.querySelector<HTMLElement>('[role="option"]')?.click()
    })

    expect(document.body.querySelector<HTMLInputElement>("#topic")?.value).toBe("secret preset")
    expect(document.body.querySelector<HTMLInputElement>("#count")?.value).toBe("9")
  })

  it("saves a new preset before running and does not track parameter values", async () => {
    mocks.presetSave.mockResolvedValue({ id: "preset-2", workflowId: "workflow-1", name: "新预设", values: { topic: "secret" }, createdAt: 1, updatedAt: 1 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      document.body.querySelector<HTMLInputElement>("#topic")!.value = "secret"
      document.body.querySelector<HTMLInputElement>("#topic")!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存为预设并运行")?.click()
    })
    const nameInput = document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')
    expect(nameInput?.value).toMatch(/^新预设 /)
    await act(async () => {
      nameInput!.value = "新预设"
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存并运行")?.click()
    })

    expect(mocks.presetSave).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "新预设", values: { topic: "secret", count: "3" } })
    expect(onConfirm).toHaveBeenCalledWith({ topic: "secret", count: 3 }, { topic: "secret", count: "3" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret")
  })

  it("requires overwrite confirmation for duplicate preset names", async () => {
    const duplicate = new Error("Preset name already exists")
    mocks.presetSave.mockRejectedValueOnce(duplicate)
    mocks.presetSave.mockResolvedValueOnce({ id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret" }, createdAt: 1, updatedAt: 2 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      document.body.querySelector<HTMLInputElement>("#topic")!.value = "secret"
      document.body.querySelector<HTMLInputElement>("#topic")!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存为预设并运行")?.click()
    })
    await act(async () => {
      const input = document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')!
      input.value = "课程"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存并运行")?.click()
    })
    expect(document.body.textContent).toContain("覆盖预设？")

    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "覆盖并运行")?.click()
    })

    expect(mocks.presetSave).toHaveBeenLastCalledWith({ workflowId: "workflow-1", name: "课程", values: { topic: "secret", count: "3" }, overwritePresetId: "preset-1" })
    expect(onConfirm).toHaveBeenCalled()
  })

  it("deletes the selected preset without clearing the current form", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret preset", count: "9" }, createdAt: 1, updatedAt: 2 },
    ])
    mocks.presetDelete.mockResolvedValue(undefined)
    await renderDialog()

    document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    await act(async () => {
      document.body.querySelector<HTMLElement>('[role="option"]')?.click()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "删除")?.click()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "删除")?.click()
    })

    expect(mocks.presetDelete).toHaveBeenCalledWith("preset-1")
    expect(document.body.querySelector<HTMLInputElement>("#topic")?.value).toBe("secret preset")
  })
```

- [ ] **Step 3: Run dialog tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: FAIL because `RunParamsDialog` lacks `workflowId`, preset loading, preset controls, save dialog, and delete behavior.

- [ ] **Step 4: Keep failing tests in the working tree**

Do not commit this red state. Leave `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx` modified and proceed directly to Task 4 so the next commit contains both the tests and the passing UI implementation.

---

### Task 4: Run Parameter Dialog Implementation

**Files:**
- Modify: `desktop/src/modules/workflow/components/run-params-dialog.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-list.tsx`
- Modify: `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx`
- Test: `desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx`

- [ ] **Step 1: Update `RunParamsDialog` props and callers**

Change `RunParamsDialogProps` in `desktop/src/modules/workflow/components/run-params-dialog.tsx`:

```ts
interface RunParamsDialogProps {
  open: boolean
  workflowId: string
  params: WorkflowParam[]
  lastValues?: Record<string, string>
  onConfirm: (values: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  onCancel: () => void
}
```

Update function signature:

```ts
export function RunParamsDialog({ open, workflowId, params, lastValues, onConfirm, onCancel }: RunParamsDialogProps) {
```

In `desktop/src/modules/workflow/components/workflow-list.tsx`, format the dialog call and pass `workflowId`:

```tsx
      <RunParamsDialog
        open={!!runTarget}
        workflowId={runTarget?.id ?? ""}
        params={runTarget?.params ?? []}
        lastValues={runTarget ? lastRunValues[runTarget.id] : undefined}
        onConfirm={async (params, rawValues) => {
          if (runTarget) setLastRunValues((prev) => ({ ...prev, [runTarget.id]: rawValues }))
          await handleConfirmRun(params).catch(() => {})
        }}
        onCancel={() => setRunTarget(null)}
      />
```

In `desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx`, pass:

```tsx
        workflowId={definition.id}
```

- [ ] **Step 2: Add preset state and helpers**

In `run-params-dialog.tsx`, update imports:

```ts
import { useEffect, useMemo, useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Trash2 } from "lucide-react"
import { toast } from "sonner"
import { track } from "@/lib/ui-tracking"
import type { WorkflowParam, WorkflowParamPreset } from "@/types/workflow"
```

Add helpers above the component:

```ts
const NO_PRESET_VALUE = "__none__"

function valuesFromParams(params: WorkflowParam[], lastValues?: Record<string, string>): Record<string, string> {
  return Object.fromEntries(params.map((param) => [
    param.name,
    lastValues?.[param.name] ?? String(param.default ?? ""),
  ]))
}

function rawValuesForParams(params: WorkflowParam[], values: Record<string, string>): Record<string, string> {
  return Object.fromEntries(params.map((param) => [param.name, values[param.name] ?? String(param.default ?? "")]))
}

function nextPresetName(existing: readonly WorkflowParamPreset[]): string {
  const date = new Date().toISOString().slice(0, 10)
  const base = `新预设 ${date}`
  const names = new Set(existing.map((preset) => preset.name))
  if (!names.has(base)) return base
  let index = 2
  while (names.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}
```

Inside the component, add state:

```ts
  const [presets, setPresets] = useState<WorkflowParamPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string>(NO_PRESET_VALUE)
  const [presetsLoading, setPresetsLoading] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [presetName, setPresetName] = useState("")
  const [savingPreset, setSavingPreset] = useState(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deletingPreset, setDeletingPreset] = useState(false)
  const [overwriteConfirm, setOverwriteConfirm] = useState<WorkflowParamPreset | null>(null)
```

Add derived selected preset:

```ts
  const selectedPreset = useMemo(
    () => presets.find((preset) => preset.id === selectedPresetId) ?? null,
    [presets, selectedPresetId],
  )
```

- [ ] **Step 3: Load presets and apply selected preset**

Add this effect:

```ts
  useEffect(() => {
    if (!open) return
    setSubmitting(false)
    setErrors({})
    setSelectedPresetId(NO_PRESET_VALUE)
    setSaveDialogOpen(false)
    setOverwriteConfirm(null)
    setValues(valuesFromParams(params, lastValues))
    if (!workflowId || params.length === 0) {
      setPresets([])
      return
    }
    let cancelled = false
    setPresetsLoading(true)
    window.synapse?.workflowParamPresets.list(workflowId)
      .then((items) => {
        if (!cancelled) setPresets(items)
      })
      .catch((error) => {
        if (!cancelled) {
          setPresets([])
          toast.error("读取预设失败")
        }
      })
      .finally(() => {
        if (!cancelled) setPresetsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, params, lastValues, workflowId])
```

Replace the old open effect with this one.

Add selection handler:

```ts
  const handlePresetSelect = (presetId: string) => {
    setSelectedPresetId(presetId)
    const preset = presets.find((item) => item.id === presetId)
    if (!preset) {
      setValues(valuesFromParams(params, lastValues))
      return
    }
    setValues(rawValuesForParams(params, preset.values))
    setErrors({})
  }
```

- [ ] **Step 4: Add save, overwrite, delete, and submit helpers**

Refactor parsing into a helper inside the component:

```ts
  function parseValues(): Record<string, unknown> {
    const parsed: Record<string, unknown> = {}
    for (const param of params) {
      if (param.type === "number") {
        const raw = values[param.name]
        const num = Number(raw)
        parsed[param.name] = raw === "" || Number.isNaN(num) ? (param.default ?? 0) : num
      } else {
        parsed[param.name] = values[param.name]
      }
    }
    return parsed
  }
```

Update `handleSubmit` to use `parseValues()` and add tracking fields:

```ts
  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (submitting) return
    if (!validate()) return
    setSubmitting(true)
    const parsed = parseValues()
    track({
      component: "workflow",
      name: "workflow-run-params-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.run-params.submit",
        workflowId,
        paramCount: params.length,
        numberParamCount: params.filter((param) => param.type === "number").length,
        textParamCount: params.filter((param) => param.type === "text").length,
        hasLastValues: Boolean(lastValues),
        selectedPresetId: selectedPreset?.id,
        savedPreset: false,
      },
    })
    try {
      await onConfirm(parsed, values)
    } finally {
      setSubmitting(false)
    }
  }
```

Add save-dialog opener:

```ts
  const handleOpenSaveDialog = () => {
    if (submitting || savingPreset) return
    if (!validate()) return
    setPresetName(selectedPreset?.name ?? nextPresetName(presets))
    setSaveDialogOpen(true)
  }
```

Add save-and-run:

```ts
  const savePresetAndRun = async (overwritePresetId?: string) => {
    const name = presetName.trim()
    if (!name) return
    setSavingPreset(true)
    try {
      const saved = await window.synapse?.workflowParamPresets.save({
        workflowId,
        name,
        values,
        ...(overwritePresetId ? { overwritePresetId } : {}),
      })
      if (saved) {
        setPresets((current) => [saved, ...current.filter((preset) => preset.id !== saved.id)])
        setSelectedPresetId(saved.id)
      }
      track({
        component: "workflow",
        name: "workflow-run-params-submit",
        action: "submit",
        metadata: {
          boundary: "renderer.workflow.run-params.submit",
          workflowId,
          paramCount: params.length,
          numberParamCount: params.filter((param) => param.type === "number").length,
          textParamCount: params.filter((param) => param.type === "text").length,
          hasLastValues: Boolean(lastValues),
          selectedPresetId: saved?.id,
          savedPreset: true,
        },
      })
      setSaveDialogOpen(false)
      setOverwriteConfirm(null)
      setSubmitting(true)
      try {
        await onConfirm(parseValues(), values)
      } finally {
        setSubmitting(false)
      }
    } catch (error) {
      const existing = presets.find((preset) => preset.name === name)
      if (existing && !overwritePresetId) {
        setOverwriteConfirm(existing)
      } else {
        toast.error("保存预设失败")
      }
    } finally {
      setSavingPreset(false)
    }
  }
```

Add delete:

```ts
  const handleDeletePreset = async () => {
    if (!selectedPreset) return
    setDeletingPreset(true)
    try {
      await window.synapse?.workflowParamPresets.delete(selectedPreset.id)
      setPresets((current) => current.filter((preset) => preset.id !== selectedPreset.id))
      setSelectedPresetId(NO_PRESET_VALUE)
      setDeleteConfirmOpen(false)
    } catch {
      toast.error("删除预设失败")
    } finally {
      setDeletingPreset(false)
    }
  }
```

- [ ] **Step 5: Replace JSX with wider layout and dialogs**

Use this structure for the return body:

```tsx
  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen && !submitting && !savingPreset) onCancel() }}>
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={handleSubmit} className="grid gap-3">
            <DialogHeader>
              <DialogTitle>设置运行参数</DialogTitle>
            </DialogHeader>
            {params.length > 0 && (
              <div className="grid gap-1.5">
                <Label htmlFor="workflow-run-param-preset">预设</Label>
                <div className="flex items-center gap-2">
                  <Select value={selectedPresetId} onValueChange={handlePresetSelect} disabled={presetsLoading || submitting || savingPreset}>
                    <SelectTrigger id="workflow-run-param-preset" className="w-full">
                      <SelectValue placeholder="未选择预设" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_PRESET_VALUE}>未选择预设</SelectItem>
                      {presets.map((preset) => (
                        <SelectItem key={preset.id} value={preset.id}>{preset.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    disabled={!selectedPreset || deletingPreset || submitting || savingPreset}
                    onClick={() => setDeleteConfirmOpen(true)}
                    aria-label="删除预设"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            )}
            <ScrollArea className="max-h-[60vh] pr-2">
              <div className="grid gap-3 py-1">
                {params.length === 0 && <p className="text-sm text-muted-foreground">此工作流无需参数。</p>}
                {params.map((param) => (
                  <div key={param.name} className="grid gap-1.5 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] sm:items-start">
                    <Label htmlFor={param.name} className="pt-2 leading-5">
                      {param.description ?? param.name}
                    </Label>
                    <div className="grid gap-1.5">
                      {param.type === "number" ? (
                        <Input
                          id={param.name}
                          type="number"
                          value={values[param.name] ?? ""}
                          onChange={(event) => {
                            setValues((current) => ({ ...current, [param.name]: event.target.value }))
                            if (errors[param.name]) setErrors((current) => {
                              const next = { ...current }
                              delete next[param.name]
                              return next
                            })
                          }}
                          aria-invalid={!!errors[param.name]}
                        />
                      ) : (
                        <Textarea
                          id={param.name}
                          rows={3}
                          value={values[param.name] ?? ""}
                          onChange={(event) => {
                            setValues((current) => ({ ...current, [param.name]: event.target.value }))
                            if (errors[param.name]) setErrors((current) => {
                              const next = { ...current }
                              delete next[param.name]
                              return next
                            })
                          }}
                          aria-invalid={!!errors[param.name]}
                        />
                      )}
                      {errors[param.name] && <p className="text-xs text-destructive">{errors[param.name]}</p>}
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting || savingPreset}>取消</Button>
              {params.length > 0 && (
                <Button type="button" variant="outline" onClick={handleOpenSaveDialog} disabled={submitting || savingPreset}>
                  保存为预设并运行
                </Button>
              )}
              <Button type="submit" disabled={submitting || savingPreset}>运行</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={saveDialogOpen} onOpenChange={(nextOpen) => { if (!nextOpen && !savingPreset) setSaveDialogOpen(false) }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>保存预设</DialogTitle>
          </DialogHeader>
          <div className="grid gap-1.5 py-2">
            <Label htmlFor="workflow-run-param-preset-name">名称</Label>
            <Input
              id="workflow-run-param-preset-name"
              aria-label="预设名称"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSaveDialogOpen(false)} disabled={savingPreset}>取消</Button>
            <Button type="button" onClick={() => void savePresetAndRun()} disabled={savingPreset || !presetName.trim()}>保存并运行</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={!!overwriteConfirm} onOpenChange={(nextOpen) => { if (!nextOpen) setOverwriteConfirm(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>覆盖预设？</AlertDialogTitle>
            <AlertDialogDescription>已存在同名预设。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingPreset}>取消</AlertDialogCancel>
            <Button onClick={() => overwriteConfirm && void savePresetAndRun(overwriteConfirm.id)} disabled={savingPreset}>覆盖并运行</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除预设？</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletingPreset}>取消</AlertDialogCancel>
            <Button variant="destructive" onClick={() => void handleDeletePreset()} disabled={deletingPreset}>删除</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
```

- [ ] **Step 6: Run dialog tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Update affected mocks and run workflow list/editor tests**

In `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`, update the `RunParamsDialog` mock prop type to include `workflowId`:

```ts
vi.mock("../run-params-dialog", () => ({
  RunParamsDialog: ({
    open,
    workflowId,
    onConfirm,
  }: {
    open: boolean
    workflowId: string
    onConfirm: (params: Record<string, unknown>, rawValues: Record<string, string>) => Promise<void>
  }) => open ? (
    <button
      data-testid="confirm-run-params"
      data-workflow-id={workflowId}
      onClick={() => void onConfirm({ topic: "value" }, { topic: "value" })}
    >
      confirm
    </button>
  ) : null,
}))
```

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

```bash
git add desktop/src/modules/workflow/components/run-params-dialog.tsx desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx desktop/src/modules/workflow/components/workflow-list.tsx desktop/src/modules/workflow/editor/canvas-floating-toolbar.tsx desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx
git commit -m "feat: add workflow run parameter preset UI"
```

---

### Task 5: Release Notes, Typecheck, And Final Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: full targeted validation commands

- [ ] **Step 1: Update release notes**

Add one bullet under the current pending release section in `RELEASE_NOTES_PENDING.md`:

```md
- 工作流运行参数弹窗更宽、更易填写，并支持把当前参数保存为当前工作流的预设，后续运行时可直接选择复用。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/__tests__/workflow-param-preset-service.test.ts \
  desktop/electron/services/__tests__/workflow-service.test.ts \
  desktop/electron/modules/workflow/__tests__/ipc.test.ts \
  desktop/electron/__tests__/preload.test.ts \
  desktop/src/modules/workflow/components/__tests__/run-params-dialog.test.tsx \
  desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx \
  desktop/src/modules/workflow/editor/__tests__/editor-app.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Run hard-constraints check**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS. This specifically protects against custom colors, inline styles, and other project UI violations.

- [ ] **Step 5: Inspect git diff for sensitive logging**

Run:

```bash
git diff --check
rg -n "values|secret|token|Authorization|console\\.log|style=\\{\\{" desktop/src/modules/workflow/components/run-params-dialog.tsx desktop/electron/modules/workflow/ipc.ts desktop/electron/services/workflow/workflow-param-preset-service.ts
```

Expected:

- `git diff --check` prints no whitespace errors.
- `rg` may show `values` in type-safe storage and bridge calls.
- `rg` must not show `console.log`.
- `rg` must not show `style={{`.
- IPC and service logs must not include raw `values`.

- [ ] **Step 6: Commit final verification changes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note workflow parameter presets"
```

- [ ] **Step 7: Final status**

Run:

```bash
git status --short
```

Expected: clean working tree.

---

## Self-Review Notes

- Spec coverage: dialog width/layout is Task 4; workflow-scoped persistence is Task 1; selection/save/overwrite/delete UI is Tasks 3 and 4; IPC bridge is Task 2; release notes are Task 5.
- Sensitive data: plan explicitly forbids logging preset `values`; tests check tracking and IPC logs do not include secret sample strings.
- Scope: no global preset sharing, no standalone management page, no workflow package export/import changes.
- Type consistency: shared renderer type is `WorkflowParamPreset`; main storage type is `WorkflowParamPresetEntryV1`; bridge save input is `SaveWorkflowParamPresetInput`; service method names are `list`, `save`, `delete`, and `deleteForWorkflow`.
