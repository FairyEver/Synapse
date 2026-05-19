# Workflow Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build file-based workflow export/import with model-reference mapping so trusted teammates can share one workflow file and quickly map the original provider/model choices to their local providers.

**Architecture:** Add shared workflow package types, then keep package construction, inspection, mapping, and import rewrite in a main-process `WorkflowPackageService`. Workflow IPC owns native dialogs and permission checks, renderer UI only displays typed preview data and submits confirmed mappings.

**Tech Stack:** Electron main process, React, TypeScript, shadcn/ui, Vitest, existing `WorkflowService`, existing `ProviderService`, existing workflow IPC registry.

---

## File Structure

- Create `desktop/src/types/workflow-package.ts` for package, model reference, mapping, preview, and provider option types shared by main and renderer.
- Create `desktop/electron/services/workflow/workflow-package-service.ts` for pure package logic, provider metadata resolution, suggested mappings, and import rewrite.
- Create `desktop/electron/services/__tests__/workflow-package-service.test.ts` for main-process service tests.
- Modify `desktop/electron/bootstrap/descriptors.ts` to register `core.workflow.package`.
- Modify `desktop/electron/modules/workflow/ipc.ts` to add export/inspect/import handlers and zod schemas.
- Modify `desktop/electron/modules/workflow/__tests__/ipc.test.ts` to cover the new workflow IPC handlers.
- Modify `desktop/electron/preload.ts`, `desktop/electron/generated/ipc-channels.generated.ts`, and `desktop/src/types/bridge.ts` to expose the new bridge methods.
- Create `desktop/src/modules/workflow/components/workflow-import-dialog.tsx` for the model mapping dialog.
- Modify `desktop/src/modules/workflow/index.tsx` and `desktop/src/modules/workflow/components/workflow-list.tsx` to wire import/export actions.
- Modify `desktop/src/modules/workflow/components/workflow-card.tsx` for a per-workflow export button.
- Create `desktop/src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx` and extend existing workflow module/list/card tests.

Do not start a dev server or browser preview for verification. Use source-level tests and type checks.

## Task 1: Shared Package Types

**Files:**
- Create: `desktop/src/types/workflow-package.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: typecheck through later tasks

- [ ] **Step 1: Create shared package types**

Create `desktop/src/types/workflow-package.ts` with this content:

```ts
import type { WorkflowDefinition } from "./workflow"

export type WorkflowPackageModelTier = "default" | "haiku" | "sonnet" | "opus"

export type WorkflowModelOccurrence =
  | { kind: "workflowDefault" }
  | {
      kind: "node"
      nodeId: string
      nodeName: string
      nodeType: string
      inherited: boolean
    }

export interface WorkflowModelReference {
  id: string
  sourceProviderId?: string
  sourceProviderName?: string
  sourceModelTier: WorkflowPackageModelTier
  sourceModelName?: string
  missingOnExporter?: boolean
  occurrences: WorkflowModelOccurrence[]
}

export interface SynapseWorkflowPackageV1 {
  format: "synapse-workflow-package-v1"
  exportedAt: string
  workflow: WorkflowDefinition
  modelReferences: WorkflowModelReference[]
}

export interface WorkflowModelMapping {
  sourceRefId: string
  targetProviderId: string
  targetModelTier: WorkflowPackageModelTier
}

export interface WorkflowImportProviderOption {
  providerId: string
  providerName: string
  active?: boolean
  models: Record<WorkflowPackageModelTier, string | undefined>
}

export interface WorkflowImportPreview {
  packagePath: string
  workflow: {
    id: string
    name: string
    nodeCount: number
    modelReferenceCount: number
  }
  modelReferences: WorkflowModelReference[]
  providerOptions: WorkflowImportProviderOption[]
  suggestedMappings: WorkflowModelMapping[]
}
```

- [ ] **Step 2: Import workflow package types in the bridge type file**

Modify the import section of `desktop/src/types/bridge.ts` to include:

```ts
import type {
  WorkflowImportPreview,
  WorkflowModelMapping,
} from "./workflow-package"
```

Do not add bridge methods yet; Task 5 adds them with IPC.

- [ ] **Step 3: Run the targeted type check after type usage exists**

Skip command execution in this task. These types are unused until later tasks. The first meaningful typecheck happens in Task 5.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/types/workflow-package.ts desktop/src/types/bridge.ts
git commit -m "feat: add workflow package shared types"
```

## Task 2: WorkflowPackageService Core Logic

**Files:**
- Create: `desktop/electron/services/workflow/workflow-package-service.ts`
- Create: `desktop/electron/services/__tests__/workflow-package-service.test.ts`
- Test: `pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-package-service.test.ts`

- [ ] **Step 1: Write failing service tests**

Create `desktop/electron/services/__tests__/workflow-package-service.test.ts` with these tests:

```ts
import { describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import type { WorkflowModelMapping } from "../../../src/types/workflow-package"
import { WorkflowPackageService } from "../workflow/workflow-package-service"

const nowIso = "2026-05-19T10:00:00.000Z"

function workflowDefinition(): WorkflowDefinition {
  return {
    id: "workflow-source",
    name: "Shared Workflow",
    version: "v_old",
    createdAt: 1,
    updatedAt: 2,
    defaultProviderId: "provider-deepseek",
    defaultModelTier: "sonnet",
    params: [],
    nodes: [
      {
        id: "n1",
        name: "分析",
        type: "prompt",
        position: { x: 0, y: 0 },
        config: { prompt: "Analyze", variables: [] },
      },
      {
        id: "n2",
        name: "终审",
        type: "prompt",
        position: { x: 200, y: 0 },
        config: { providerId: "provider-claude", modelTier: "opus", prompt: "Review", variables: [] },
      },
      {
        id: "end",
        name: "结束",
        type: "end",
        position: { x: 400, y: 0 },
        config: { outputType: "text", template: "", variables: [] },
      },
    ],
    edges: [
      { id: "e1", from: "n1", to: "n2" },
      { id: "e2", from: "n2", to: "end" },
    ],
  }
}

function createService() {
  const saved: WorkflowDefinition[] = []
  const workflowService = {
    get: vi.fn(async (id: string) => id === "workflow-source" ? workflowDefinition() : null),
    save: vi.fn(async (def: WorkflowDefinition) => {
      saved.push(def)
      return { versionHash: "v_imported" }
    }),
  }
  const providerService = {
    listProviders: vi.fn(async () => [
      {
        id: "provider-deepseek",
        name: "DeepSeek",
        category: "cn_official",
        apiKeyField: "ANTHROPIC_API_KEY",
        active: true,
        model: "deepseek-chat",
        sonnetModel: "deepseek-reasoner",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "provider-claude",
        name: "Claude",
        category: "official",
        apiKeyField: "ANTHROPIC_API_KEY",
        model: "claude-haiku",
        opusModel: "claude-opus",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
      {
        id: "local-openai",
        name: "OpenAI",
        category: "official",
        apiKeyField: "ANTHROPIC_API_KEY",
        model: "gpt-5-mini",
        sonnetModel: "gpt-5",
        opusModel: "gpt-5-pro",
        env: {},
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    ]),
  }
  const service = new WorkflowPackageService({
    workflowService,
    providerService,
    now: () => new Date(nowIso),
    createId: () => "workflow-imported",
  })
  return { service, workflowService, providerService, saved }
}

describe("WorkflowPackageService", () => {
  it("builds an export package with grouped model references", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")

    expect(pkg.format).toBe("synapse-workflow-package-v1")
    expect(pkg.exportedAt).toBe(nowIso)
    expect(pkg.workflow.id).toBe("workflow-source")
    expect(pkg.modelReferences).toHaveLength(2)
    expect(pkg.modelReferences).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceProviderId: "provider-deepseek",
        sourceProviderName: "DeepSeek",
        sourceModelTier: "sonnet",
        sourceModelName: "deepseek-reasoner",
        occurrences: expect.arrayContaining([
          { kind: "workflowDefault" },
          expect.objectContaining({ kind: "node", nodeId: "n1", inherited: true }),
        ]),
      }),
      expect.objectContaining({
        sourceProviderId: "provider-claude",
        sourceProviderName: "Claude",
        sourceModelTier: "opus",
        sourceModelName: "claude-opus",
        occurrences: [expect.objectContaining({ kind: "node", nodeId: "n2", inherited: false })],
      }),
    ]))
  })

  it("builds an import preview with provider options and suggested mappings", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const preview = await service.buildImportPreview("/tmp/shared.synapse-workflow.json", pkg)

    expect(preview.packagePath).toBe("/tmp/shared.synapse-workflow.json")
    expect(preview.workflow).toEqual({
      id: "workflow-source",
      name: "Shared Workflow",
      nodeCount: 3,
      modelReferenceCount: 2,
    })
    expect(preview.providerOptions.map((p) => p.providerId)).toEqual([
      "provider-deepseek",
      "provider-claude",
      "local-openai",
    ])
    expect(preview.suggestedMappings).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetProviderId: "provider-deepseek", targetModelTier: "sonnet" }),
      expect.objectContaining({ targetProviderId: "provider-claude", targetModelTier: "opus" }),
    ]))
  })

  it("imports as a new workflow and preserves inherited provider structure", async () => {
    const { service, saved } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const mappings: WorkflowModelMapping[] = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "local-openai",
      targetModelTier: ref.sourceModelTier === "opus" ? "opus" : "sonnet",
    }))

    const result = await service.importPackage(pkg, mappings)

    expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_imported" })
    expect(saved).toHaveLength(1)
    const imported = saved[0]
    expect(imported.id).toBe("workflow-imported")
    expect(imported.version).toBe("")
    expect(imported.createdAt).toBe(Date.parse(nowIso))
    expect(imported.defaultProviderId).toBe("local-openai")
    expect(imported.defaultModelTier).toBe("sonnet")
    expect(imported.nodes.find((node) => node.id === "n1")?.config.providerId).toBeUndefined()
    expect(imported.nodes.find((node) => node.id === "n2")?.config.providerId).toBe("local-openai")
    expect(imported.nodes.find((node) => node.id === "n2")?.config.modelTier).toBe("opus")
  })

  it("rejects import when a model reference has no mapping", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")

    await expect(service.importPackage(pkg, [])).rejects.toThrow(/Missing model mapping/)
  })

  it("rejects import when a mapping targets an unknown provider", async () => {
    const { service } = createService()
    const pkg = await service.buildExportPackage("workflow-source")
    const mappings = pkg.modelReferences.map((ref) => ({
      sourceRefId: ref.id,
      targetProviderId: "missing-provider",
      targetModelTier: "default" as const,
    }))

    await expect(service.importPackage(pkg, mappings)).rejects.toThrow(/Unknown target provider/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-package-service.test.ts
```

Expected: FAIL because `workflow-package-service.ts` does not exist.

- [ ] **Step 3: Implement `WorkflowPackageService`**

Create `desktop/electron/services/workflow/workflow-package-service.ts` with this implementation shape:

```ts
import type { WorkflowDefinition, WorkflowNode, ValidationError } from "../../../src/types/workflow"
import type {
  SynapseWorkflowPackageV1,
  WorkflowImportPreview,
  WorkflowImportProviderOption,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "../../../src/types/workflow-package"
import type { ProviderService } from "../provider"
import type { CCProvider } from "../provider/types"
import type { WorkflowService, WorkflowSaveError, WorkflowSaveResult } from "./workflow-service"

const PACKAGE_FORMAT = "synapse-workflow-package-v1" as const
const MODEL_TIERS: readonly WorkflowPackageModelTier[] = ["default", "haiku", "sonnet", "opus"]

interface WorkflowPackageServiceDeps {
  readonly workflowService: Pick<WorkflowService, "get" | "save">
  readonly providerService: Pick<ProviderService, "listProviders">
  readonly now?: () => Date
  readonly createId?: () => string
}

export class WorkflowPackageService {
  private readonly workflowService: Pick<WorkflowService, "get" | "save">
  private readonly providerService: Pick<ProviderService, "listProviders">
  private readonly now: () => Date
  private readonly createId: () => string

  constructor(deps: WorkflowPackageServiceDeps) {
    this.workflowService = deps.workflowService
    this.providerService = deps.providerService
    this.now = deps.now ?? (() => new Date())
    this.createId = deps.createId ?? (() => crypto.randomUUID())
  }

  async buildExportPackage(workflowId: string): Promise<SynapseWorkflowPackageV1> {
    const workflow = await this.workflowService.get(workflowId)
    if (!workflow) throw new Error(`Workflow ${workflowId} not found`)
    const providers = await this.providerService.listProviders()
    return {
      format: PACKAGE_FORMAT,
      exportedAt: this.now().toISOString(),
      workflow,
      modelReferences: buildModelReferences(workflow, providers),
    }
  }

  async buildImportPreview(packagePath: string, pkg: SynapseWorkflowPackageV1): Promise<WorkflowImportPreview> {
    assertPackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerOptions = providers.map(toProviderOption)
    return {
      packagePath,
      workflow: {
        id: pkg.workflow.id,
        name: pkg.workflow.name,
        nodeCount: pkg.workflow.nodes.length,
        modelReferenceCount: pkg.modelReferences.length,
      },
      modelReferences: pkg.modelReferences,
      providerOptions,
      suggestedMappings: suggestMappings(pkg.modelReferences, providerOptions),
    }
  }

  async importPackage(
    pkg: SynapseWorkflowPackageV1,
    mappings: readonly WorkflowModelMapping[],
  ): Promise<{ workflowId: string; versionHash: string } | WorkflowSaveError> {
    assertPackage(pkg)
    const providers = await this.providerService.listProviders()
    const providerIds = new Set(providers.map((provider) => provider.id))
    const mappingByRef = new Map(mappings.map((mapping) => [mapping.sourceRefId, mapping]))

    for (const ref of pkg.modelReferences) {
      const mapping = mappingByRef.get(ref.id)
      if (!mapping) throw new Error(`Missing model mapping for ${ref.id}`)
      if (!providerIds.has(mapping.targetProviderId)) throw new Error(`Unknown target provider ${mapping.targetProviderId}`)
      if (!MODEL_TIERS.includes(mapping.targetModelTier)) throw new Error(`Invalid target model tier ${mapping.targetModelTier}`)
    }

    const imported = rewriteWorkflowForImport(pkg.workflow, pkg.modelReferences, mappingByRef, this.createId(), this.now().getTime())
    const saveResult = await this.workflowService.save(imported)
    if ("errors" in saveResult) return saveResult
    return { workflowId: imported.id, versionHash: (saveResult as WorkflowSaveResult).versionHash }
  }
}

function buildModelReferences(workflow: WorkflowDefinition, providers: readonly CCProvider[]): WorkflowModelReference[] {
  const providerById = new Map(providers.map((provider) => [provider.id, provider]))
  const refs = new Map<string, WorkflowModelReference>()

  function add(providerId: string | undefined, tier: WorkflowPackageModelTier, occurrence: WorkflowModelReference["occurrences"][number]) {
    if (!providerId) return
    const provider = providerById.get(providerId)
    const modelName = provider ? modelNameForTier(provider, tier) : undefined
    const key = `${providerId}\u0000${tier}\u0000${modelName ?? ""}`
    const existing = refs.get(key)
    if (existing) {
      existing.occurrences.push(occurrence)
      return
    }
    refs.set(key, {
      id: `model-ref-${refs.size + 1}`,
      sourceProviderId: providerId,
      sourceProviderName: provider?.name,
      sourceModelTier: tier,
      sourceModelName: modelName,
      ...(provider ? {} : { missingOnExporter: true }),
      occurrences: [occurrence],
    })
  }

  const defaultTier = workflow.defaultModelTier ?? "default"
  add(workflow.defaultProviderId, defaultTier, { kind: "workflowDefault" })

  for (const node of workflow.nodes) {
    if (!isModelNode(node)) continue
    const config = node.config as { providerId?: unknown; modelTier?: unknown }
    const explicitProviderId = typeof config.providerId === "string" && config.providerId.length > 0 ? config.providerId : undefined
    const explicitTier = isModelTier(config.modelTier) ? config.modelTier : "default"
    if (explicitProviderId) {
      add(explicitProviderId, explicitTier, modelNodeOccurrence(node, false))
    } else if (workflow.defaultProviderId) {
      add(workflow.defaultProviderId, defaultTier, modelNodeOccurrence(node, true))
    }
  }

  return Array.from(refs.values())
}

function rewriteWorkflowForImport(
  workflow: WorkflowDefinition,
  refs: readonly WorkflowModelReference[],
  mappingByRef: ReadonlyMap<string, WorkflowModelMapping>,
  id: string,
  timestamp: number,
): WorkflowDefinition {
  let next: WorkflowDefinition = {
    ...workflow,
    id,
    version: "",
    createdAt: timestamp,
    updatedAt: timestamp,
    nodes: workflow.nodes.map((node) => ({ ...node, config: { ...node.config } })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
    params: workflow.params.map((param) => ({ ...param })),
  }

  for (const ref of refs) {
    const mapping = mappingByRef.get(ref.id)
    if (!mapping) continue
    for (const occurrence of ref.occurrences) {
      if (occurrence.kind === "workflowDefault") {
        next = { ...next, defaultProviderId: mapping.targetProviderId, defaultModelTier: mapping.targetModelTier }
      } else if (!occurrence.inherited) {
        next = {
          ...next,
          nodes: next.nodes.map((node) =>
            node.id === occurrence.nodeId
              ? { ...node, config: { ...node.config, providerId: mapping.targetProviderId, modelTier: mapping.targetModelTier } }
              : node,
          ),
        }
      }
    }
  }

  return next
}

function modelNodeOccurrence(node: WorkflowNode, inherited: boolean): WorkflowModelReference["occurrences"][number] {
  return { kind: "node", nodeId: node.id, nodeName: node.name, nodeType: node.type, inherited }
}

function isModelNode(node: WorkflowNode): boolean {
  return node.type === "prompt" || node.type === "switch"
}

function isModelTier(value: unknown): value is WorkflowPackageModelTier {
  return typeof value === "string" && MODEL_TIERS.includes(value as WorkflowPackageModelTier)
}

function modelNameForTier(provider: CCProvider, tier: WorkflowPackageModelTier): string | undefined {
  if (tier === "haiku") return provider.haikuModel ?? provider.model
  if (tier === "sonnet") return provider.sonnetModel ?? provider.model
  if (tier === "opus") return provider.opusModel ?? provider.model
  return provider.model
}

function toProviderOption(provider: CCProvider): WorkflowImportProviderOption {
  return {
    providerId: provider.id,
    providerName: provider.name,
    active: provider.active,
    models: {
      default: provider.model,
      haiku: provider.haikuModel ?? provider.model,
      sonnet: provider.sonnetModel ?? provider.model,
      opus: provider.opusModel ?? provider.model,
    },
  }
}

function suggestMappings(
  refs: readonly WorkflowModelReference[],
  providers: readonly WorkflowImportProviderOption[],
): WorkflowModelMapping[] {
  const active = providers.find((provider) => provider.active) ?? providers[0]
  if (!active) return []
  return refs.map((ref) => {
    const byProviderName = providers.find((provider) => provider.providerName === ref.sourceProviderName)
    const byModelName = providers.find((provider) =>
      Object.values(provider.models).some((model) => model && model === ref.sourceModelName),
    )
    const target = byProviderName ?? byModelName ?? active
    return {
      sourceRefId: ref.id,
      targetProviderId: target.providerId,
      targetModelTier: ref.sourceModelTier,
    }
  })
}

function assertPackage(value: SynapseWorkflowPackageV1): void {
  if (!value || value.format !== PACKAGE_FORMAT) throw new Error("Invalid workflow package format")
  if (!value.workflow || typeof value.workflow.id !== "string") throw new Error("Invalid workflow package workflow")
  if (!Array.isArray(value.modelReferences)) throw new Error("Invalid workflow package model references")
}
```

If TypeScript reports `crypto.randomUUID()` is not available in this module context, import `randomUUID` from `node:crypto` and use `deps.createId ?? randomUUID`.

- [ ] **Step 4: Run service test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-package-service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-package-service.ts desktop/electron/services/__tests__/workflow-package-service.test.ts
git commit -m "feat: add workflow package service"
```

## Task 3: Register WorkflowPackageService

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Test: `pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/descriptors.test.ts`

- [ ] **Step 1: Write failing descriptor test**

Open `desktop/electron/bootstrap/__tests__/descriptors.test.ts` and add an assertion near the workflow descriptor assertions:

```ts
expect(byId.get("core.workflow.package")?.dependsOn).toEqual(["core.workflow", "provider"])
```

Run the descriptor test before implementation.

- [ ] **Step 2: Run descriptor test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: FAIL because `core.workflow.package` is not registered.

- [ ] **Step 3: Register descriptor**

In `desktop/electron/bootstrap/descriptors.ts`, import:

```ts
import { WorkflowPackageService } from "../services/workflow/workflow-package-service"
import type { ProviderService } from "../services/provider"
import { PROVIDER_SERVICE_ID } from "../services/provider"
```

Add a service descriptor after `coreWorkflowDescriptor`:

```ts
export const coreWorkflowPackageDescriptor: ServiceDescriptor<WorkflowPackageService> = {
  id: "core.workflow.package",
  criticality: "degraded",
  dependsOn: ["core.workflow", PROVIDER_SERVICE_ID],
  create(ctx) {
    return new WorkflowPackageService({
      workflowService: ctx.registry.get<WorkflowService>("core.workflow"),
      providerService: ctx.registry.get<ProviderService>(PROVIDER_SERVICE_ID),
    })
  },
}
```

Add `coreWorkflowPackageDescriptor` to the exported descriptor list in the same file, next to the other workflow descriptors.

- [ ] **Step 4: Run descriptor test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat: register workflow package service"
```

## Task 4: Workflow IPC Handlers

**Files:**
- Modify: `desktop/electron/modules/workflow/ipc.ts`
- Modify: `desktop/electron/modules/workflow/__tests__/ipc.test.ts`
- Test: `pnpm --filter @synapse/desktop exec vitest run electron/modules/workflow/__tests__/ipc.test.ts`

- [ ] **Step 1: Add failing IPC tests**

Append tests to `desktop/electron/modules/workflow/__tests__/ipc.test.ts`:

```ts
it("exports a workflow package through the package service", async () => {
  const packageService = { buildExportPackage: vi.fn(async () => ({ format: "synapse-workflow-package-v1", exportedAt: "2026-05-19T10:00:00.000Z", workflow: workflowDefinition(), modelReferences: [] })) }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.workflow.package") return packageService as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

  const result = await harness.invoke("synapse:workflow:export-package-data", { workflowId: "workflow-1" })

  expect(packageService.buildExportPackage).toHaveBeenCalledWith("workflow-1")
  expect(result).toMatchObject({ format: "synapse-workflow-package-v1" })
})

it("previews a workflow package with mappings", async () => {
  const preview = {
    packagePath: "/tmp/workflow.synapse-workflow.json",
    workflow: { id: "workflow-1", name: "Workflow", nodeCount: 1, modelReferenceCount: 0 },
    modelReferences: [],
    providerOptions: [],
    suggestedMappings: [],
  }
  const packageService = { buildImportPreview: vi.fn(async () => preview) }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.workflow.package") return packageService as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

  const result = await harness.invoke("synapse:workflow:inspect-import-package-data", {
    packagePath: "/tmp/workflow.synapse-workflow.json",
    packageData: { format: "synapse-workflow-package-v1", exportedAt: "2026-05-19T10:00:00.000Z", workflow: workflowDefinition(), modelReferences: [] },
  })

  expect(packageService.buildImportPreview).toHaveBeenCalled()
  expect(result).toEqual(preview)
})

it("imports a workflow package through the package service", async () => {
  const packageService = { importPackage: vi.fn(async () => ({ workflowId: "workflow-imported", versionHash: "v_1" })) }
  const harness = createInMemoryHarness()
  const resolve: IpcHandlerContext["resolve"] = <T,>(serviceId: string): T => {
    if (serviceId === "core.workflow.package") return packageService as T
    throw new Error(`Unknown service: ${serviceId}`)
  }
  harness.registry.register(workflowIpcModule, { moduleId: "workflow", resolve })

  const result = await harness.invoke("synapse:workflow:import-package-data", {
    packageData: { format: "synapse-workflow-package-v1", exportedAt: "2026-05-19T10:00:00.000Z", workflow: workflowDefinition(), modelReferences: [] },
    mappings: [],
  })

  expect(packageService.importPackage).toHaveBeenCalled()
  expect(result).toEqual({ workflowId: "workflow-imported", versionHash: "v_1" })
})
```

These tests use data-only channels to avoid mocking Electron dialogs. Dialog-backed channels are added in the same handler file but can be tested through integration later.

- [ ] **Step 2: Run IPC test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: FAIL because the new channels do not exist.

- [ ] **Step 3: Add zod schemas and data-only IPC methods**

In `desktop/electron/modules/workflow/ipc.ts`, import:

```ts
import { BrowserWindow, dialog } from "electron"
import { readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import type { WorkflowPackageService } from "../../services/workflow/workflow-package-service"
import type { SynapseWorkflowPackageV1, WorkflowModelMapping } from "../../../src/types/workflow-package"
```

If `BrowserWindow` or `dialog` is already imported in this file after local edits, extend the existing import instead of duplicating it.

Add zod schemas near the workflow schemas:

```ts
const modelTierSchema = z.enum(["default", "haiku", "sonnet", "opus"])
const workflowModelOccurrenceSchema = z.union([
  z.object({ kind: z.literal("workflowDefault") }),
  z.object({
    kind: z.literal("node"),
    nodeId: z.string(),
    nodeName: z.string(),
    nodeType: z.string(),
    inherited: z.boolean(),
  }),
])
const workflowModelReferenceSchema = z.object({
  id: z.string(),
  sourceProviderId: z.string().optional(),
  sourceProviderName: z.string().optional(),
  sourceModelTier: modelTierSchema,
  sourceModelName: z.string().optional(),
  missingOnExporter: z.boolean().optional(),
  occurrences: z.array(workflowModelOccurrenceSchema),
})
const workflowPackageSchema = z.object({
  format: z.literal("synapse-workflow-package-v1"),
  exportedAt: z.string(),
  workflow: workflowDefinitionSchema,
  modelReferences: z.array(workflowModelReferenceSchema),
})
const workflowModelMappingSchema = z.object({
  sourceRefId: z.string(),
  targetProviderId: z.string(),
  targetModelTier: modelTierSchema,
})
const workflowImportPreviewSchema = z.object({
  packagePath: z.string(),
  workflow: z.object({
    id: z.string(),
    name: z.string(),
    nodeCount: z.number(),
    modelReferenceCount: z.number(),
  }),
  modelReferences: z.array(workflowModelReferenceSchema),
  providerOptions: z.array(z.object({
    providerId: z.string(),
    providerName: z.string(),
    active: z.boolean().optional(),
    models: z.record(modelTierSchema, z.string().optional()),
  })),
  suggestedMappings: z.array(workflowModelMappingSchema),
})
```

Add methods inside `workflowIpcModule.methods`:

```ts
exportPackageData: {
  channel: "synapse:workflow:export-package-data", kind: "invoke",
  request: z.object({ workflowId: z.string() }),
  response: workflowPackageSchema,
  handler: async (ctx, { workflowId }: { workflowId: string }) =>
    ctx.resolve<WorkflowPackageService>("core.workflow.package").buildExportPackage(workflowId),
},
inspectImportPackageData: {
  channel: "synapse:workflow:inspect-import-package-data", kind: "invoke",
  request: z.object({ packagePath: z.string(), packageData: workflowPackageSchema }),
  response: workflowImportPreviewSchema,
  handler: async (ctx, { packagePath, packageData }: { packagePath: string; packageData: SynapseWorkflowPackageV1 }) =>
    ctx.resolve<WorkflowPackageService>("core.workflow.package").buildImportPreview(packagePath, packageData),
},
importPackageData: {
  channel: "synapse:workflow:import-package-data", kind: "invoke",
  request: z.object({ packageData: workflowPackageSchema, mappings: z.array(workflowModelMappingSchema) }),
  response: z.union([
    z.object({ workflowId: z.string(), versionHash: z.string() }),
    z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
  ]),
  handler: async (ctx, { packageData, mappings }: { packageData: SynapseWorkflowPackageV1; mappings: WorkflowModelMapping[] }) =>
    ctx.resolve<WorkflowPackageService>("core.workflow.package").importPackage(packageData, mappings),
},
```

- [ ] **Step 4: Run IPC test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: PASS for the data-only IPC tests and existing tests.

- [ ] **Step 5: Add dialog-backed IPC methods**

Still in `desktop/electron/modules/workflow/ipc.ts`, add helper:

```ts
function focusedWindow(): Electron.BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow()
    ?? BrowserWindow.getAllWindows().find((window) => window.isVisible() && !window.isDestroyed())
    ?? undefined
}
```

Add methods:

```ts
exportPackage: {
  channel: "synapse:workflow:export-package", kind: "invoke",
  request: z.object({ workflowId: z.string(), workflowName: z.string().optional() }),
  response: z.object({ path: z.string() }).nullable(),
  handler: async (ctx, { workflowId, workflowName }: { workflowId: string; workflowName?: string }) => {
    const pkg = await ctx.resolve<WorkflowPackageService>("core.workflow.package").buildExportPackage(workflowId)
    const safeName = (workflowName || pkg.workflow.name || "workflow").replace(/[\\/:*?"<>|]/g, "-")
    const result = await dialog.showSaveDialog(focusedWindow(), {
      title: "导出工作流",
      defaultPath: `${safeName}.synapse-workflow.json`,
      filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
    })
    if (result.canceled || !result.filePath) return null
    await writeFile(result.filePath, `${JSON.stringify(pkg, null, 2)}\n`, "utf-8")
    logger.info("workflow package exported", { workflowId, fileBase: path.basename(result.filePath) })
    return { path: result.filePath }
  },
},
inspectImportPackage: {
  channel: "synapse:workflow:inspect-import-package", kind: "invoke",
  request: z.void().optional(),
  response: workflowImportPreviewSchema.nullable(),
  handler: async (ctx) => {
    const result = await dialog.showOpenDialog(focusedWindow(), {
      title: "导入工作流",
      filters: [{ name: "Synapse Workflow", extensions: ["json"] }],
      properties: ["openFile"],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const packagePath = result.filePaths[0]
    const raw = JSON.parse(await readFile(packagePath, "utf-8"))
    const packageData = workflowPackageSchema.parse(raw) as SynapseWorkflowPackageV1
    return ctx.resolve<WorkflowPackageService>("core.workflow.package").buildImportPreview(packagePath, packageData)
  },
},
importPackage: {
  channel: "synapse:workflow:import-package", kind: "invoke",
  request: z.object({ packagePath: z.string(), mappings: z.array(workflowModelMappingSchema) }),
  response: z.union([
    z.object({ workflowId: z.string(), versionHash: z.string() }),
    z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) }),
  ]),
  handler: async (ctx, { packagePath, mappings }: { packagePath: string; mappings: WorkflowModelMapping[] }) => {
    const raw = JSON.parse(await readFile(packagePath, "utf-8"))
    const packageData = workflowPackageSchema.parse(raw) as SynapseWorkflowPackageV1
    return ctx.resolve<WorkflowPackageService>("core.workflow.package").importPackage(packageData, mappings)
  },
},
```

Before finalizing this task, apply the repository's sensitive-operation rule: add `PermissionGuard.check()` and `AuditSink` records around `writeFile` and `readFile`, following the existing task scheduler IPC helpers in `desktop/electron/modules/task-scheduler/ipc.ts`. Use source strings `workflow.exportPackage`, `workflow.inspectImportPackage`, and `workflow.importPackage`.

- [ ] **Step 6: Run hard constraints and IPC test**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
pnpm --filter @synapse/desktop exec vitest run electron/modules/workflow/__tests__/ipc.test.ts
```

Expected: both PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/modules/workflow/ipc.ts desktop/electron/modules/workflow/__tests__/ipc.test.ts
git commit -m "feat: add workflow package ipc"
```

## Task 5: Preload, Generated Channels, and Bridge Types

**Files:**
- Modify: `desktop/electron/preload.ts`
- Modify: `desktop/electron/generated/ipc-channels.generated.ts`
- Modify: `desktop/src/types/bridge.ts`
- Test: `pnpm --filter @synapse/desktop run typecheck`

- [ ] **Step 1: Add bridge type methods**

In `desktop/src/types/bridge.ts`, extend `workflow`:

```ts
exportPackage: (workflowId: string, workflowName?: string) => Promise<{ path: string } | null>
inspectImportPackage: () => Promise<WorkflowImportPreview | null>
importPackage: (packagePath: string, mappings: WorkflowModelMapping[]) => Promise<{ workflowId: string; versionHash: string } | { errors: ValidationError[] }>
```

- [ ] **Step 2: Add preload channel constants and bridge functions**

In `desktop/electron/preload.ts`, add workflow channel entries:

```ts
"exportPackage": "synapse:workflow:export-package",
"inspectImportPackage": "synapse:workflow:inspect-import-package",
"importPackage": "synapse:workflow:import-package",
```

Add bridge methods:

```ts
exportPackage: (workflowId: string, workflowName?: string) =>
  invoke(IPC_CHANNELS.workflow.exportPackage)({ workflowId, workflowName }),
inspectImportPackage: () => invoke(IPC_CHANNELS.workflow.inspectImportPackage)(),
importPackage: (packagePath: string, mappings) =>
  invoke(IPC_CHANNELS.workflow.importPackage)({ packagePath, mappings }),
```

- [ ] **Step 3: Update generated IPC channels**

In `desktop/electron/generated/ipc-channels.generated.ts`, add matching workflow channel entries:

```ts
"exportPackage": "synapse:workflow:export-package",
"inspectImportPackage": "synapse:workflow:inspect-import-package",
"importPackage": "synapse:workflow:import-package",
```

If the repo has a working generator script, use it instead of hand-editing this generated file. If no obvious generator command exists, hand-edit to keep preload and generated channels aligned.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/preload.ts desktop/electron/generated/ipc-channels.generated.ts desktop/src/types/bridge.ts
git commit -m "feat: expose workflow package bridge"
```

## Task 6: Workflow Import Dialog UI

**Files:**
- Create: `desktop/src/modules/workflow/components/workflow-import-dialog.tsx`
- Create: `desktop/src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx`
- Test: `pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx`

- [ ] **Step 1: Write failing dialog tests**

Create `desktop/src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx`:

```ts
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { WorkflowImportPreview, WorkflowModelMapping } from "@/types/workflow-package"
import { WorkflowImportDialog } from "../workflow-import-dialog"

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) {
    act(() => root?.unmount())
  }
  root = null
  container?.remove()
  container = null
})

function renderDialog(props: Partial<Parameters<typeof WorkflowImportDialog>[0]> = {}) {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  const onImport = vi.fn()
  act(() => {
    root!.render(
      <WorkflowImportDialog
        open
        preview={preview()}
        importing={false}
        onOpenChange={vi.fn()}
        onImport={onImport}
        {...props}
      />,
    )
  })
  return { onImport }
}

function preview(): WorkflowImportPreview {
  return {
    packagePath: "/tmp/shared.synapse-workflow.json",
    workflow: { id: "workflow-1", name: "Shared Workflow", nodeCount: 3, modelReferenceCount: 2 },
    modelReferences: [
      {
        id: "ref-1",
        sourceProviderId: "deepseek",
        sourceProviderName: "DeepSeek",
        sourceModelTier: "sonnet",
        sourceModelName: "deepseek-reasoner",
        occurrences: [{ kind: "workflowDefault" }, { kind: "node", nodeId: "n1", nodeName: "分析", nodeType: "prompt", inherited: true }],
      },
      {
        id: "ref-2",
        sourceProviderId: "claude",
        sourceProviderName: "Claude",
        sourceModelTier: "opus",
        sourceModelName: "claude-opus",
        occurrences: [{ kind: "node", nodeId: "n2", nodeName: "终审", nodeType: "prompt", inherited: false }],
      },
    ],
    providerOptions: [
      { providerId: "local-openai", providerName: "OpenAI", active: true, models: { default: "gpt-5-mini", haiku: "gpt-5-mini", sonnet: "gpt-5", opus: "gpt-5-pro" } },
      { providerId: "local-deepseek", providerName: "DeepSeek", models: { default: "deepseek-chat", haiku: "deepseek-chat", sonnet: "deepseek-reasoner", opus: "deepseek-reasoner" } },
    ],
    suggestedMappings: [
      { sourceRefId: "ref-1", targetProviderId: "local-deepseek", targetModelTier: "sonnet" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "opus" },
    ],
  }
}

describe("WorkflowImportDialog", () => {
  it("renders original model references and usage summary", () => {
    renderDialog()

    expect(document.body.textContent).toContain("Shared Workflow")
    expect(document.body.textContent).toContain("DeepSeek")
    expect(document.body.textContent).toContain("deepseek-reasoner")
    expect(document.body.textContent).toContain("全局")
    expect(document.body.textContent).toContain("分析")
    expect(document.body.textContent).toContain("终审")
  })

  it("submits suggested mappings by default", () => {
    const { onImport } = renderDialog()
    const button = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    act(() => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onImport).toHaveBeenCalledWith([
      { sourceRefId: "ref-1", targetProviderId: "local-deepseek", targetModelTier: "sonnet" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "opus" },
    ] satisfies WorkflowModelMapping[])
  })

  it("maps all rows to the active default model", () => {
    const { onImport } = renderDialog()
    const allButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "全部使用默认模型")
    act(() => allButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    const importButton = Array.from(document.querySelectorAll("button")).find((node) => node.textContent === "导入")
    act(() => importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })))

    expect(onImport).toHaveBeenCalledWith([
      { sourceRefId: "ref-1", targetProviderId: "local-openai", targetModelTier: "default" },
      { sourceRefId: "ref-2", targetProviderId: "local-openai", targetModelTier: "default" },
    ])
  })
})
```

- [ ] **Step 2: Run dialog test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx
```

Expected: FAIL because the dialog component does not exist.

- [ ] **Step 3: Implement dialog**

Create `desktop/src/modules/workflow/components/workflow-import-dialog.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import type {
  WorkflowImportPreview,
  WorkflowModelMapping,
  WorkflowModelReference,
  WorkflowPackageModelTier,
} from "@/types/workflow-package"

const MODEL_TIERS: readonly WorkflowPackageModelTier[] = ["default", "haiku", "sonnet", "opus"]

interface WorkflowImportDialogProps {
  open: boolean
  preview: WorkflowImportPreview | null
  importing?: boolean
  onOpenChange: (open: boolean) => void
  onImport: (mappings: WorkflowModelMapping[]) => void
}

function WorkflowImportDialog({ open, preview, importing = false, onOpenChange, onImport }: WorkflowImportDialogProps) {
  const [mappings, setMappings] = useState<Record<string, WorkflowModelMapping>>({})
  const activeProvider = preview?.providerOptions.find((provider) => provider.active) ?? preview?.providerOptions[0]

  useEffect(() => {
    if (!preview) {
      setMappings({})
      return
    }
    setMappings(Object.fromEntries(preview.suggestedMappings.map((mapping) => [mapping.sourceRefId, mapping])))
  }, [preview])

  const rows = preview?.modelReferences ?? []
  const canImport = Boolean(preview) && rows.every((row) => mappings[row.id]?.targetProviderId && mappings[row.id]?.targetModelTier)

  const providerById = useMemo(
    () => new Map((preview?.providerOptions ?? []).map((provider) => [provider.providerId, provider])),
    [preview],
  )

  function updateMapping(refId: string, patch: Partial<WorkflowModelMapping>) {
    setMappings((prev) => {
      const current = prev[refId] ?? {
        sourceRefId: refId,
        targetProviderId: activeProvider?.providerId ?? "",
        targetModelTier: "default" as const,
      }
      return { ...prev, [refId]: { ...current, ...patch } }
    })
  }

  function useDefaultForAll() {
    if (!preview || !activeProvider) return
    setMappings(Object.fromEntries(preview.modelReferences.map((ref) => [ref.id, {
      sourceRefId: ref.id,
      targetProviderId: activeProvider.providerId,
      targetModelTier: "default" as const,
    }])))
  }

  function handleImport() {
    if (!preview) return
    onImport(preview.modelReferences.map((ref) => mappings[ref.id]))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-[760px]">
        <DialogHeader>
          <DialogTitle>导入工作流</DialogTitle>
        </DialogHeader>
        {preview ? (
          <>
            <div className="flex items-center gap-3 border-b pb-3 text-sm">
              <span className="font-medium">{preview.workflow.name}</span>
              <span className="text-muted-foreground">{preview.workflow.nodeCount} 个节点</span>
              <span className="text-muted-foreground">{preview.workflow.modelReferenceCount} 个模型</span>
            </div>
            <ScrollArea className="min-h-0 flex-1 pr-3">
              <div className="space-y-3">
                {rows.map((ref) => {
                  const mapping = mappings[ref.id]
                  const provider = mapping ? providerById.get(mapping.targetProviderId) : undefined
                  return (
                    <div key={ref.id} className="grid gap-3 border-b pb-3 md:grid-cols-[1.2fr_1fr_1.2fr]">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{formatSourceModel(ref)}</div>
                        <div className="truncate text-xs text-muted-foreground">{ref.sourceModelTier}</div>
                      </div>
                      <div className="min-w-0 text-xs text-muted-foreground">{formatOccurrences(ref)}</div>
                      <div className="grid grid-cols-2 gap-2">
                        <Select value={mapping?.targetProviderId ?? ""} onValueChange={(value) => updateMapping(ref.id, { targetProviderId: value })}>
                          <SelectTrigger aria-label={`${ref.id} provider`}>
                            <SelectValue placeholder="供应商" />
                          </SelectTrigger>
                          <SelectContent>
                            {preview.providerOptions.map((option) => (
                              <SelectItem key={option.providerId} value={option.providerId}>{option.providerName}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select value={mapping?.targetModelTier ?? "default"} onValueChange={(value) => updateMapping(ref.id, { targetModelTier: value as WorkflowPackageModelTier })}>
                          <SelectTrigger aria-label={`${ref.id} tier`}>
                            <SelectValue placeholder="模型" />
                          </SelectTrigger>
                          <SelectContent>
                            {MODEL_TIERS.map((tier) => (
                              <SelectItem key={tier} value={tier}>{provider?.models[tier] ?? tier}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
          </>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={importing} onClick={() => onOpenChange(false)}>取消</Button>
          <Button type="button" variant="outline" disabled={!preview || importing || !activeProvider} onClick={useDefaultForAll}>全部使用默认模型</Button>
          <Button type="button" disabled={!canImport || importing} onClick={handleImport}>{importing ? "导入中..." : "导入"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatSourceModel(ref: WorkflowModelReference): string {
  return [ref.sourceProviderName ?? ref.sourceProviderId ?? "未知供应商", ref.sourceModelName ?? ref.sourceModelTier].join(" / ")
}

function formatOccurrences(ref: WorkflowModelReference): string {
  return ref.occurrences.map((occurrence) => {
    if (occurrence.kind === "workflowDefault") return "全局"
    return occurrence.nodeName
  }).join("、")
}

export { WorkflowImportDialog }
export type { WorkflowImportDialogProps }
```

If the project's `Select` primitive is missing from `desktop/src/components/ui/`, add the official shadcn select component in a separate tiny commit before this task. If it exists, do not create a parallel select primitive.

- [ ] **Step 4: Run dialog test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/components/workflow-import-dialog.tsx desktop/src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx
git commit -m "feat: add workflow import mapping dialog"
```

## Task 7: Wire Workflow List Import/Export

**Files:**
- Modify: `desktop/src/modules/workflow/index.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-list.tsx`
- Modify: `desktop/src/modules/workflow/components/workflow-card.tsx`
- Modify: existing tests under `desktop/src/modules/workflow/**/__tests__/`
- Test: `pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/__tests__/workflow-module.test.tsx src/modules/workflow/components/__tests__/workflow-list.test.tsx src/modules/workflow/components/__tests__/workflow-card.test.tsx`

- [ ] **Step 1: Extend card test for export action**

In `desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx`, extend the interaction test to pass `onExport={onExport}` and assert:

```ts
const exportButton = container.querySelector<HTMLButtonElement>('[aria-label="导出工作流"]')
exportButton?.click()
expect(onExport).toHaveBeenCalled()
```

- [ ] **Step 2: Run card test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/components/__tests__/workflow-card.test.tsx
```

Expected: FAIL because `WorkflowCard` has no export button.

- [ ] **Step 3: Add export button to WorkflowCard**

Modify `WorkflowCardProps` in `desktop/src/modules/workflow/components/workflow-card.tsx`:

```ts
interface WorkflowCardProps {
  meta: WorkflowMeta
  running?: boolean
  runState?: WorkflowCardRunState
  onOpen: () => void
  onRun: () => void
  onHistory: () => void
  onExport: () => void
  onDelete: () => void
}
```

Import `Download` from `lucide-react`, then add this button before delete:

```tsx
<Button
  type="button"
  size="sm"
  variant="ghost"
  aria-label="导出工作流"
  data-track="workflow-card-export"
  onClick={(e) => { e.stopPropagation(); onExport() }}
>
  <Download className="h-3.5 w-3.5" />
</Button>
```

- [ ] **Step 4: Run card test**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/components/__tests__/workflow-card.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Wire export in WorkflowList**

In `desktop/src/modules/workflow/components/workflow-list.tsx`, add:

```ts
const handleExport = async (id: string, name: string) => {
  try {
    const result = await requireBridgeDomain("workflow").exportPackage(id, name)
    if (!result) return
    toast.success("工作流已导出")
  } catch (err) {
    logger.warn("Workflow export failed.", {
      boundary: "renderer.workflow.list.export",
      workflowId: id,
      ...errorDiagnostic(err),
    })
    toast.error("导出失败，请重试")
  }
}
```

Pass to card:

```tsx
onExport={() => void handleExport(meta.id, meta.name)}
```

- [ ] **Step 6: Wire import in WorkflowModule**

In `desktop/src/modules/workflow/index.tsx`, import `Upload` and `WorkflowImportDialog`, add state:

```ts
const [importPreview, setImportPreview] = useState<WorkflowImportPreview | null>(null)
const [importing, setImporting] = useState(false)
```

Add handlers:

```ts
const handleImportStart = async () => {
  try {
    const preview = await requireBridgeDomain("workflow").inspectImportPackage()
    if (preview) setImportPreview(preview)
  } catch (err) {
    logger.warn("Workflow import preview failed.", {
      boundary: "renderer.workflow.import.preview",
      ...errorDiagnostic(err),
    })
    toast.error("导入失败，请重试")
  }
}

const handleImportConfirm = async (mappings: WorkflowModelMapping[]) => {
  if (!importPreview) return
  setImporting(true)
  try {
    const result = await requireBridgeDomain("workflow").importPackage(importPreview.packagePath, mappings)
    if ("errors" in result) {
      toast.error(result.errors[0]?.message ?? "导入失败：校验未通过")
      return
    }
    setImportPreview(null)
    setListKey((key) => key + 1)
    toast.success("工作流已导入")
    await requireBridgeDomain("workflow").openEditor(result.workflowId)
  } catch (err) {
    logger.warn("Workflow import failed.", {
      boundary: "renderer.workflow.import",
      ...errorDiagnostic(err),
    })
    toast.error("导入失败，请重试")
  } finally {
    setImporting(false)
  }
}
```

Add an outline import button next to `新建`:

```tsx
<Button size="sm" variant="outline" onClick={handleImportStart}>
  <Upload className="h-4 w-4 mr-1.5" />导入
</Button>
```

Render the dialog:

```tsx
<WorkflowImportDialog
  open={!!importPreview}
  preview={importPreview}
  importing={importing}
  onOpenChange={(open) => { if (!open) setImportPreview(null) }}
  onImport={(mappings) => void handleImportConfirm(mappings)}
/>
```

Remember to import `WorkflowImportPreview` and `WorkflowModelMapping` from `@/types/workflow-package`.

- [ ] **Step 7: Extend workflow module/list tests**

In `desktop/src/modules/workflow/__tests__/workflow-module.test.tsx`, add bridge mocks for:

```ts
inspectImportPackage: vi.fn(async () => null)
importPackage: vi.fn()
exportPackage: vi.fn()
```

Add a test that clicks `导入` and expects `inspectImportPackage` to be called.

In `desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx`, add `exportPackage` to the workflow bridge mock and assert clicking `[data-track="workflow-card-export"]` calls it with the workflow id and name.

- [ ] **Step 8: Run workflow UI tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run src/modules/workflow/__tests__/workflow-module.test.tsx src/modules/workflow/components/__tests__/workflow-list.test.tsx src/modules/workflow/components/__tests__/workflow-card.test.tsx src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/src/modules/workflow/index.tsx desktop/src/modules/workflow/components/workflow-list.tsx desktop/src/modules/workflow/components/workflow-card.tsx desktop/src/modules/workflow/components/__tests__/workflow-card.test.tsx desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/__tests__/workflow-module.test.tsx
git commit -m "feat: wire workflow import export ui"
```

## Task 8: Final Verification

**Files:**
- No new files
- Test: hard constraints, focused tests, typecheck

- [ ] **Step 1: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 2: Run focused workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-package-service.test.ts electron/modules/workflow/__tests__/ipc.test.ts src/modules/workflow/__tests__/workflow-module.test.tsx src/modules/workflow/components/__tests__/workflow-list.test.tsx src/modules/workflow/components/__tests__/workflow-card.test.tsx src/modules/workflow/components/__tests__/workflow-import-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only workflow package/import-export files from this plan are changed. Existing unrelated dirty files from before this implementation may still appear; do not revert them.

- [ ] **Step 5: Commit remaining verification fixes**

If Task 8 required any small fixes, commit them:

```bash
git add <files changed by Task 8>
git commit -m "fix: stabilize workflow package import export"
```

If there are no changes after verification, skip this commit.

## Self-Review Notes

- Spec coverage: package format, model references, provider/model display, many-to-one mappings, import-as-new-workflow, inherited-node preservation, no run history, IPC, UI, and tests are all covered by tasks.
- Scope: this remains file-based single-workflow sharing and does not add cloud sharing, marketplace, batch import, run history export, or redaction.
- Type consistency: the plan consistently uses `WorkflowModelReference`, `WorkflowModelMapping`, `WorkflowImportPreview`, and `SynapseWorkflowPackageV1`.
