# Provider Reference Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect provider references from silent breakage when providers are modified or deleted, with delete guard + migration wizard + graceful fallback + tier warnings.

**Architecture:** Add `ProviderReferenceScanner` for cross-module reference scanning and migration, extend `ProviderService` with `deleteProvider`/`listAllProviders`/`buildEnvSafe`, expose 4 new IPC channels, add a delete dialog with migration UI, and sprinkle tier degradation warnings into existing display components.

**Tech Stack:** TypeScript, Electron IPC, React, shadcn/ui, Vitest

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `electron/services/provider/provider-reference-scanner.ts` | Scan references + migrate logic |
| `electron/services/provider/__tests__/provider-reference-scanner.test.ts` | Scanner unit tests |
| `electron/services/provider/__tests__/provider-delete.test.ts` | deleteProvider + buildEnvSafe tests |
| `src/lib/provider-reference-validation.ts` | Pure renderer-side reference validation |
| `src/lib/__tests__/provider-reference-validation.test.ts` | Validation function tests |
| `src/modules/settings/components/provider-delete-dialog.tsx` | Delete confirmation + migration wizard UI |

### Modified files

| File | Change |
|---|---|
| `electron/services/provider/provider-service.ts` | Add `deleteProvider`, `listAllProviders`, `buildEnvSafe` |
| `electron/services/provider/index.ts` | Re-export new methods |
| `electron/modules/provider/ipc.ts` (or equivalent IPC registration) | 4 new channels |
| `electron/preload.ts` | Expose new bridge methods |
| `src/types/bridge.ts` | Bridge type declarations |
| `action-packages/builtin/agent/executor.main.ts` | Provider availability pre-check |
| `src/modules/settings/components/provider-panel.tsx` | Add "删除" action + wire dialog |
| `src/modules/task-scheduler/task-card.tsx` | Tier warning badge |
| `workflow-nodes/prompt/panel.tsx` | Tier warning indicator |
| `workflow-nodes/switch/panel.tsx` | Tier warning indicator |
| `src/modules/agent/index.tsx` | Provider unavailable notice |

---

## Task 1: ProviderService — deleteProvider + listAllProviders + buildEnvSafe

**Files:**
- Modify: `electron/services/provider/provider-service.ts`
- Modify: `electron/services/provider/index.ts`
- Create: `electron/services/provider/__tests__/provider-delete.test.ts`

- [ ] **Step 1: Write failing tests for deleteProvider**

```typescript
// electron/services/provider/__tests__/provider-delete.test.ts
import { describe, expect, it } from "vitest"
import { ProviderService } from "../provider-service"
import { LOCAL_CLAUDE_CODE_PROVIDER_ID } from "../types"
// Import the same makeProviderService helper used in provider-service.test.ts
// (copy the factory or extract to a shared test helper)

describe("ProviderService.deleteProvider", () => {
  it("physically removes the provider record and its secret", async () => {
    const { service, providers, secrets } = makeProviderService()
    await service.createProvider({
      id: "to-delete",
      name: "Deletable",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-del",
      env: {},
    })
    await expect(providers.get("to-delete")).resolves.toBeTruthy()
    await expect(secrets.get("provider:to-delete:api-key")).resolves.toBeTruthy()

    await service.deleteProvider("to-delete")

    await expect(providers.get("to-delete")).resolves.toBeNull()
    await expect(secrets.get("provider:to-delete:api-key")).resolves.toBeNull()
  })

  it("rejects deleting the built-in local provider", async () => {
    const { service } = makeProviderService()
    await expect(service.deleteProvider(LOCAL_CLAUDE_CODE_PROVIDER_ID))
      .rejects.toThrow("cannot be deleted")
  })

  it("switches active to local-claude-code before deleting active provider", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "active-one",
      name: "Active",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      active: true,
      env: {},
    })
    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: "active-one" })

    await service.deleteProvider("active-one")

    await expect(service.getActiveProvider()).resolves.toMatchObject({ id: LOCAL_CLAUDE_CODE_PROVIDER_ID })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-delete.test.ts`
Expected: FAIL — `deleteProvider` is not defined

- [ ] **Step 3: Implement deleteProvider**

In `electron/services/provider/provider-service.ts`, add after `archiveProvider`:

```typescript
async deleteProvider(id: string): Promise<void> {
  if (id === LOCAL_PROVIDER_ID) {
    throw new Error("The local Claude Code provider cannot be deleted.")
  }
  const provider = await this.getProvider(id)
  if (provider.active) {
    await this.clearActiveUserProvider()
  }
  // Delete secrets
  if (provider.secretRef) {
    await this.secretStore.deleteSecret(provider.secretRef)
  }
  if (provider.secretEnvRefs) {
    for (const secretRef of Object.values(provider.secretEnvRefs)) {
      await this.secretStore.deleteSecret(secretRef)
    }
  }
  // Physical delete
  await this.providers.remove(id)
}
```

Note: Check if `ProviderSecretStore` has a `deleteSecret` method. If not, add one that calls `this.secrets.remove(id)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-delete.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for listAllProviders**

Add to the same test file:

```typescript
describe("ProviderService.listAllProviders", () => {
  it("includes archived providers", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "archived-one",
      name: "Archived",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    await service.archiveProvider("archived-one")

    const all = await service.listAllProviders()
    const regular = await service.listProviders()

    expect(all.some((p) => p.id === "archived-one")).toBe(true)
    expect(regular.some((p) => p.id === "archived-one")).toBe(false)
  })
})
```

- [ ] **Step 6: Implement listAllProviders**

```typescript
async listAllProviders(): Promise<readonly CCProvider[]> {
  const providers = (await this.providers.list({ scope: "global", kind: PROVIDER_KIND } as Partial<ProviderEntryV1>))
    .map(toProvider)
    .sort((a, b) => (a.sortIndex ?? 0) - (b.sortIndex ?? 0))
  const hasActiveUserProvider = providers.some((p) => p.active && !p.archived)
  return [
    await this.localClaudeCodeProvider(!hasActiveUserProvider),
    ...providers,
  ]
}
```

- [ ] **Step 7: Write failing tests for buildEnvSafe**

```typescript
describe("ProviderService.buildEnvSafe", () => {
  it("returns ok:true for existing provider", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "valid",
      name: "Valid",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      apiKey: "sk-valid",
      env: {},
    })

    const result = await service.buildEnvSafe("valid")
    expect(result).toEqual({ ok: true, env: expect.objectContaining({ ANTHROPIC_API_KEY: "sk-valid" }) })
  })

  it("returns ok:false with not_found for missing provider", async () => {
    const { service } = makeProviderService()

    const result = await service.buildEnvSafe("nonexistent")
    expect(result).toEqual({ ok: false, reason: "not_found", message: expect.any(String) })
  })

  it("returns ok:false with archived for archived provider", async () => {
    const { service } = makeProviderService()
    await service.createProvider({
      id: "arch",
      name: "Arch",
      category: "custom",
      apiKeyField: "ANTHROPIC_API_KEY",
      env: {},
    })
    await service.archiveProvider("arch")

    const result = await service.buildEnvSafe("arch")
    expect(result).toEqual({ ok: true, env: expect.any(Object) })
    // Note: archived providers can still buildEnv since data exists.
    // Only truly deleted providers return not_found.
  })
})
```

- [ ] **Step 8: Implement buildEnvSafe**

```typescript
async buildEnvSafe(
  providerId: string,
  context: BuildProviderEnvContext = {},
): Promise<
  | { ok: true; env: Record<string, string> }
  | { ok: false; reason: "not_found" | "secret_error"; message: string }
> {
  try {
    const env = await this.buildEnv(providerId, context)
    return { ok: true, env }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes("not found")) {
      return { ok: false, reason: "not_found", message: "供应商已删除或不可用" }
    }
    return { ok: false, reason: "secret_error", message: "供应商密钥读取失败" }
  }
}
```

- [ ] **Step 9: Run all tests**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-delete.test.ts`
Expected: ALL PASS

- [ ] **Step 10: Export new methods from index.ts**

In `electron/services/provider/index.ts`, ensure new types are exported if needed (the methods are on the class, so they're automatically available).

- [ ] **Step 11: Commit**

```bash
git add electron/services/provider/provider-service.ts electron/services/provider/index.ts electron/services/provider/__tests__/provider-delete.test.ts
git commit -m "feat(provider): add deleteProvider, listAllProviders, buildEnvSafe"
```

---

## Task 2: ProviderReferenceScanner

**Files:**
- Create: `electron/services/provider/provider-reference-scanner.ts`
- Create: `electron/services/provider/__tests__/provider-reference-scanner.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// electron/services/provider/__tests__/provider-reference-scanner.test.ts
import { describe, expect, it } from "vitest"
import { ProviderReferenceScanner } from "../provider-reference-scanner"
import type { ProviderReferenceScannerDeps } from "../provider-reference-scanner"

function makeDeps(overrides: Partial<ProviderReferenceScannerDeps> = {}): ProviderReferenceScannerDeps {
  return {
    listTasks: async () => [],
    updateTaskAction: async () => {},
    listWorkflowNodes: async () => [],
    updateWorkflowNodeProvider: async () => {},
    listConversations: async () => [],
    ...overrides,
  }
}

describe("ProviderReferenceScanner", () => {
  describe("scan", () => {
    it("returns empty result when no references exist", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps())
      const result = await scanner.scan("some-provider")
      expect(result).toEqual({
        providerId: "some-provider",
        references: [],
        taskCount: 0,
        workflowNodeCount: 0,
        conversationCount: 0,
      })
    })

    it("finds references in tasks", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listTasks: async () => [
          { id: "task-1", name: "Daily Review", action: { type: "builtin.agent", config: { providerId: "target", modelTier: "sonnet" } } },
          { id: "task-2", name: "Other", action: { type: "builtin.agent", config: { providerId: "other", modelTier: "default" } } },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.taskCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "scheduled-task", entityId: "task-1", entityName: "Daily Review" }),
      ])
    })

    it("finds references in workflow nodes", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listWorkflowNodes: async () => [
          { workflowId: "wf-1", workflowName: "Assistant", nodeId: "n-1", nodeName: "Prompt", providerId: "target", modelTier: "opus" },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.workflowNodeCount).toBe(1)
      expect(result.references).toEqual([
        expect.objectContaining({ kind: "workflow-node", entityId: "wf-1", nodeId: "n-1" }),
      ])
    })

    it("finds references in conversations", async () => {
      const scanner = new ProviderReferenceScanner(makeDeps({
        listConversations: async () => [
          { id: "conv-1", name: "Chat 1", providerId: "target" },
          { id: "conv-2", name: "Chat 2", providerId: "other" },
        ],
      }))
      const result = await scanner.scan("target")
      expect(result.conversationCount).toBe(1)
    })
  })

  describe("migrate", () => {
    it("updates matching tasks and workflow nodes", async () => {
      const updatedTasks: Array<{ id: string; action: unknown }> = []
      const updatedNodes: Array<{ workflowId: string; nodeId: string; providerId: string; modelTier: string }> = []

      const scanner = new ProviderReferenceScanner(makeDeps({
        listTasks: async () => [
          { id: "task-1", name: "T1", action: { type: "builtin.agent", config: { providerId: "source", modelTier: "sonnet", prompt: "hello" } } },
        ],
        updateTaskAction: async (id, action) => { updatedTasks.push({ id, action }) },
        listWorkflowNodes: async () => [
          { workflowId: "wf-1", workflowName: "W1", nodeId: "n-1", nodeName: "N1", providerId: "source", modelTier: "opus" },
        ],
        updateWorkflowNodeProvider: async (wId, nId, pId, tier) => { updatedNodes.push({ workflowId: wId, nodeId: nId, providerId: pId, modelTier: tier }) },
        listConversations: async () => [],
      }))

      const result = await scanner.migrate({
        sourceProviderId: "source",
        targetProviderId: "new-provider",
        targetModelTier: "sonnet",
        scope: ["scheduled-task", "workflow-node"],
      })

      expect(result.migratedTasks).toBe(1)
      expect(result.migratedWorkflowNodes).toBe(1)
      expect(result.errors).toEqual([])
      expect(updatedTasks[0]).toEqual({
        id: "task-1",
        action: { type: "builtin.agent", config: { providerId: "new-provider", modelTier: "sonnet", prompt: "hello" } },
      })
      expect(updatedNodes[0]).toEqual({
        workflowId: "wf-1", nodeId: "n-1", providerId: "new-provider", modelTier: "sonnet",
      })
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-reference-scanner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement ProviderReferenceScanner**

```typescript
// electron/services/provider/provider-reference-scanner.ts
import type { ModelTier } from "../../../src/types/provider-model"

export interface ProviderReference {
  kind: "scheduled-task" | "workflow-node" | "conversation"
  entityId: string
  entityName: string
  nodeId?: string
  nodeName?: string
  providerId: string
  modelTier: string
}

export interface ProviderReferenceScanResult {
  providerId: string
  references: ProviderReference[]
  taskCount: number
  workflowNodeCount: number
  conversationCount: number
}

export interface MigrateProviderReferencesInput {
  sourceProviderId: string
  targetProviderId: string
  targetModelTier: ModelTier
  scope: ("scheduled-task" | "workflow-node")[]
}

export interface MigrateProviderReferencesResult {
  migratedTasks: number
  migratedWorkflowNodes: number
  errors: Array<{ entityId: string; error: string }>
}

export interface TaskActionRef {
  readonly type: string
  readonly config: Record<string, unknown>
}

export interface ProviderReferenceScannerDeps {
  listTasks: () => Promise<Array<{ id: string; name: string; action: TaskActionRef }>>
  updateTaskAction: (id: string, action: TaskActionRef) => Promise<void>
  listWorkflowNodes: () => Promise<Array<{
    workflowId: string; workflowName: string
    nodeId: string; nodeName: string
    providerId: string; modelTier: string
  }>>
  updateWorkflowNodeProvider: (
    workflowId: string, nodeId: string,
    providerId: string, modelTier: string,
  ) => Promise<void>
  listConversations: () => Promise<Array<{ id: string; name: string; providerId?: string }>>
}

export class ProviderReferenceScanner {
  constructor(private readonly deps: ProviderReferenceScannerDeps) {}

  async scan(providerId: string): Promise<ProviderReferenceScanResult> {
    const references: ProviderReference[] = []

    const tasks = await this.deps.listTasks()
    for (const task of tasks) {
      const config = task.action.config as Record<string, unknown>
      if (config.providerId === providerId) {
        references.push({
          kind: "scheduled-task",
          entityId: task.id,
          entityName: task.name,
          providerId,
          modelTier: String(config.modelTier ?? "default"),
        })
      }
    }

    const nodes = await this.deps.listWorkflowNodes()
    for (const node of nodes) {
      if (node.providerId === providerId) {
        references.push({
          kind: "workflow-node",
          entityId: node.workflowId,
          entityName: node.workflowName,
          nodeId: node.nodeId,
          nodeName: node.nodeName,
          providerId,
          modelTier: node.modelTier,
        })
      }
    }

    const conversations = await this.deps.listConversations()
    for (const conv of conversations) {
      if (conv.providerId === providerId) {
        references.push({
          kind: "conversation",
          entityId: conv.id,
          entityName: conv.name,
          providerId,
          modelTier: "",
        })
      }
    }

    return {
      providerId,
      references,
      taskCount: references.filter((r) => r.kind === "scheduled-task").length,
      workflowNodeCount: references.filter((r) => r.kind === "workflow-node").length,
      conversationCount: references.filter((r) => r.kind === "conversation").length,
    }
  }

  async migrate(input: MigrateProviderReferencesInput): Promise<MigrateProviderReferencesResult> {
    const errors: Array<{ entityId: string; error: string }> = []
    let migratedTasks = 0
    let migratedWorkflowNodes = 0

    if (input.scope.includes("scheduled-task")) {
      const tasks = await this.deps.listTasks()
      for (const task of tasks) {
        const config = task.action.config as Record<string, unknown>
        if (config.providerId !== input.sourceProviderId) continue
        try {
          const updatedAction: TaskActionRef = {
            type: task.action.type,
            config: { ...config, providerId: input.targetProviderId, modelTier: input.targetModelTier },
          }
          await this.deps.updateTaskAction(task.id, updatedAction)
          migratedTasks++
        } catch (err) {
          errors.push({ entityId: task.id, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    if (input.scope.includes("workflow-node")) {
      const nodes = await this.deps.listWorkflowNodes()
      for (const node of nodes) {
        if (node.providerId !== input.sourceProviderId) continue
        try {
          await this.deps.updateWorkflowNodeProvider(
            node.workflowId, node.nodeId,
            input.targetProviderId, input.targetModelTier,
          )
          migratedWorkflowNodes++
        } catch (err) {
          errors.push({ entityId: `${node.workflowId}:${node.nodeId}`, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    return { migratedTasks, migratedWorkflowNodes, errors }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run electron/services/provider/__tests__/provider-reference-scanner.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/provider/provider-reference-scanner.ts electron/services/provider/__tests__/provider-reference-scanner.test.ts
git commit -m "feat(provider): add ProviderReferenceScanner for cross-module reference scanning and migration"
```

---

## Task 3: IPC Channel Registration

**Files:**
- Modify: IPC registration file (find via `grep -r "provider" electron/modules/` or the bootstrap descriptors)
- Modify: `electron/preload.ts`
- Modify: `src/types/bridge.ts`

Note: Check the existing IPC pattern by looking at how `archiveProvider` is registered. Follow the same pattern for the 4 new channels.

- [ ] **Step 1: Identify the IPC registration pattern**

Look at `electron/bootstrap/descriptors.ts` or the IPC module that registers `agent.archiveProvider`. The new channels follow the same pattern.

- [ ] **Step 2: Add bridge type declarations**

In `src/types/bridge.ts` (or the file where `SynapseBridge.agent` is typed), add:

```typescript
// Add to the agent bridge interface:
scanProviderReferences: (input: { providerId: string }) => Promise<{
  providerId: string
  references: Array<{
    kind: "scheduled-task" | "workflow-node" | "conversation"
    entityId: string
    entityName: string
    nodeId?: string
    nodeName?: string
    providerId: string
    modelTier: string
  }>
  taskCount: number
  workflowNodeCount: number
  conversationCount: number
}>
deleteProvider: (input: { providerId: string }) => Promise<void>
migrateProviderReferences: (input: {
  sourceProviderId: string
  targetProviderId: string
  targetModelTier: string
  scope: ("scheduled-task" | "workflow-node")[]
}) => Promise<{
  migratedTasks: number
  migratedWorkflowNodes: number
  errors: Array<{ entityId: string; error: string }>
}>
listAllProviders: () => Promise<SynapseAgentProvider[]>
```

- [ ] **Step 3: Register IPC handlers in the main process**

Follow the existing pattern (likely in `electron/bootstrap/descriptors.ts` or a dedicated IPC module). Wire each handler to the corresponding service method:

- `provider:scan-references` → `scanner.scan(input.providerId)`
- `provider:delete` → `providerService.deleteProvider(input.providerId)`
- `provider:migrate-references` → `scanner.migrate(input)`
- `provider:list-all` → `providerService.listAllProviders()`

The scanner needs adapters wired to `TaskRepository`, `WorkflowService`, and `SessionRepository`. This wiring happens in the bootstrap/descriptor layer.

- [ ] **Step 4: Expose in preload**

In `electron/preload.ts`, expose the 4 new methods on the `agent` bridge namespace following the existing pattern.

- [ ] **Step 5: Verify compilation**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(provider): register IPC channels for scan-references, delete, migrate, list-all"
```

---

## Task 4: Execution Fallback — Agent Action Executor

**Files:**
- Modify: `action-packages/builtin/agent/executor.main.ts`
- Modify: `action-packages/builtin/agent/__tests__/executor.main.test.ts`

- [ ] **Step 1: Write failing test for provider-not-found fallback**

Add to `action-packages/builtin/agent/__tests__/executor.main.test.ts`:

```typescript
it("returns failed status when provider is not available", async () => {
  const runtime = {
    sendScheduled: vi.fn(async () => {
      throw new Error("Provider not found: deleted-provider")
    }),
  }
  const action = createAgentAction({
    getAgentRuntime: async () => runtime as unknown as AgentRuntimeService,
  })

  const result = await action.execute({
    config: {
      projectId: "project-1",
      agentType: "claude-code",
      providerId: "deleted-provider",
      modelTier: "sonnet",
      mode: "default",
      prompt: "hello",
      sessionPolicy: "fresh",
    },
    context: {
      taskId: "task-1",
      runId: "run-1",
      triggeredBy: "schedule",
      actor: { kind: "scheduler" },
      abortSignal: new AbortController().signal,
    },
    previousOutputs: undefined,
  })

  expect(result.status).toBe("failed")
  expect(result.error).toContain("供应商")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/agent/__tests__/executor.main.test.ts -t "provider is not available"`
Expected: FAIL (currently the error propagates unhandled or produces a different message)

- [ ] **Step 3: Add provider error handling in executor**

In `action-packages/builtin/agent/executor.main.ts`, wrap the `runtime.sendScheduled` call:

```typescript
async execute(input) {
  const runtime = await deps.getAgentRuntime(input.config.projectId)
  if (!runtime) {
    return {
      status: "failed",
      error: `No agent runtime found for project "${input.config.projectId}"`,
      metrics: { durationMs: 0 },
    }
  }

  // ... existing lastConversationId logic ...

  try {
    const result = await runtime.sendScheduled({ /* existing params */ })
    // ... existing result handling ...
  } catch (rawError) {
    const message = rawError instanceof Error ? rawError.message : String(rawError)
    const isProviderError = message.includes("Provider not found") || message.includes("not found")
    return {
      status: "failed",
      error: isProviderError
        ? "供应商已删除或不可用，请重新配置"
        : `Agent runtime error (${message.length} chars)`,
      metrics: { durationMs: Date.now() - startMs },
    }
  }
}
```

Note: Add `const startMs = Date.now()` at the top of `execute`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @synapse/desktop exec vitest run action-packages/builtin/agent/__tests__/executor.main.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add action-packages/builtin/agent/executor.main.ts action-packages/builtin/agent/__tests__/executor.main.test.ts
git commit -m "feat(agent-action): graceful fallback when provider is unavailable"
```

---

## Task 5: Provider Reference Validation (Renderer Pure Function)

**Files:**
- Create: `src/lib/provider-reference-validation.ts`
- Create: `src/lib/__tests__/provider-reference-validation.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/lib/__tests__/provider-reference-validation.test.ts
import { describe, expect, it } from "vitest"
import { validateProviderReference } from "../provider-reference-validation"
import type { SynapseAgentProvider } from "@/types/bridge"

const activeProvider: SynapseAgentProvider = {
  id: "active",
  name: "Active Provider",
  active: true,
  model: "claude-sonnet-4",
  sonnetModel: "claude-sonnet-4",
  haikuModel: "",
  opusModel: "claude-opus-4",
} as SynapseAgentProvider

const archivedProvider: SynapseAgentProvider = {
  ...activeProvider,
  id: "archived",
  name: "Archived",
  active: false,
  archived: true,
} as SynapseAgentProvider

describe("validateProviderReference", () => {
  it("returns valid for existing active provider with available tier", () => {
    const result = validateProviderReference("active", "sonnet", [activeProvider], [activeProvider])
    expect(result).toEqual({ valid: true })
  })

  it("returns provider_not_found when provider is missing from all providers", () => {
    const result = validateProviderReference("gone", "sonnet", [activeProvider], [activeProvider])
    expect(result).toEqual({ valid: false, reason: "provider_not_found" })
  })

  it("returns provider_archived when provider is only in allProviders", () => {
    const result = validateProviderReference("archived", "sonnet", [activeProvider], [activeProvider, archivedProvider])
    expect(result).toEqual({ valid: false, reason: "provider_archived" })
  })

  it("returns tier_unavailable when tier model is empty", () => {
    const result = validateProviderReference("active", "haiku", [activeProvider], [activeProvider])
    expect(result).toEqual({ degraded: true, reason: "tier_unavailable", fallbackModel: "claude-sonnet-4" })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/provider-reference-validation.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement validateProviderReference**

```typescript
// src/lib/provider-reference-validation.ts
import type { ModelTier } from "@/types/provider-model"
import type { SynapseAgentProvider } from "@/types/bridge"

export type ProviderReferenceStatus =
  | { valid: true }
  | { valid: false; reason: "provider_not_found" }
  | { valid: false; reason: "provider_archived" }
  | { degraded: true; reason: "tier_unavailable"; fallbackModel?: string }

function tierModelValue(provider: SynapseAgentProvider, tier: ModelTier): string | undefined {
  const raw = tier === "default" ? provider.model
    : tier === "haiku" ? provider.haikuModel
    : tier === "sonnet" ? provider.sonnetModel
    : provider.opusModel
  const trimmed = raw?.trim()
  return trimmed || undefined
}

export function validateProviderReference(
  providerId: string,
  modelTier: ModelTier,
  providers: readonly SynapseAgentProvider[],
  allProviders: readonly SynapseAgentProvider[],
): ProviderReferenceStatus {
  const inActive = providers.find((p) => p.id === providerId)
  if (inActive) {
    const tierValue = tierModelValue(inActive, modelTier)
    if (tierValue) return { valid: true }
    return { degraded: true, reason: "tier_unavailable", fallbackModel: inActive.model?.trim() || undefined }
  }

  const inAll = allProviders.find((p) => p.id === providerId)
  if (inAll) {
    return { valid: false, reason: "provider_archived" }
  }

  return { valid: false, reason: "provider_not_found" }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @synapse/desktop exec vitest run src/lib/__tests__/provider-reference-validation.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/provider-reference-validation.ts src/lib/__tests__/provider-reference-validation.test.ts
git commit -m "feat(renderer): add provider reference validation pure function"
```

---

## Task 6: Provider Delete Dialog UI

**Files:**
- Create: `src/modules/settings/components/provider-delete-dialog.tsx`
- Modify: `src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Create ProviderDeleteDialog**

```typescript
// src/modules/settings/components/provider-delete-dialog.tsx
import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import { createRendererLogger } from "@/app-shell/logging"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { SynapseAgentProvider } from "@/types/bridge"
import type { ProviderModelSelection } from "@/types/provider-model"

const logger = createRendererLogger("settings.providers")

type ProviderDeleteDialogProps = {
  readonly provider: SynapseAgentProvider | null
  readonly onOpenChange: (open: boolean) => void
  readonly onDeleted: () => void
}

type ScanState =
  | { status: "loading" }
  | { status: "loaded"; taskCount: number; workflowNodeCount: number; conversationCount: number; references: Array<{ kind: string; entityName: string; nodeName?: string }> }
  | { status: "error"; message: string }

export function ProviderDeleteDialog({ provider, onOpenChange, onDeleted }: ProviderDeleteDialogProps) {
  const [scan, setScan] = useState<ScanState>({ status: "loading" })
  const [migrationOpen, setMigrationOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!provider) return
    setScan({ status: "loading" })
    void (async () => {
      try {
        const result = await requireSynapseBridge().agent.scanProviderReferences({ providerId: provider.id })
        setScan({
          status: "loaded",
          taskCount: result.taskCount,
          workflowNodeCount: result.workflowNodeCount,
          conversationCount: result.conversationCount,
          references: result.references.map((r) => ({ kind: r.kind, entityName: r.entityName, nodeName: r.nodeName })),
        })
      } catch (err) {
        logger.error("Provider reference scan failed.", { boundary: "settings.providers.scan", providerId: provider.id })
        setScan({ status: "error", message: "扫描引用失败" })
      }
    })()
  }, [provider])

  const handleDelete = useCallback(async () => {
    if (!provider) return
    setBusy(true)
    try {
      await requireSynapseBridge().agent.deleteProvider({ providerId: provider.id })
      toast("供应商已删除")
      onDeleted()
      onOpenChange(false)
    } catch (err) {
      logger.error("Provider delete failed.", { boundary: "settings.providers.delete", providerId: provider.id })
      toast("删除失败")
    } finally {
      setBusy(false)
    }
  }, [provider, onDeleted, onOpenChange])

  const handleMigrate = useCallback(async (selection: ProviderModelSelection) => {
    if (!provider) return
    setBusy(true)
    try {
      await requireSynapseBridge().agent.migrateProviderReferences({
        sourceProviderId: provider.id,
        targetProviderId: selection.providerId,
        targetModelTier: selection.modelTier,
        scope: ["scheduled-task", "workflow-node"],
      })
      toast("引用已迁移")
      await requireSynapseBridge().agent.deleteProvider({ providerId: provider.id })
      toast("供应商已删除")
      onDeleted()
      onOpenChange(false)
    } catch (err) {
      logger.error("Provider migrate+delete failed.", { boundary: "settings.providers.migrate", providerId: provider.id })
      toast("操作失败")
    } finally {
      setBusy(false)
      setMigrationOpen(false)
    }
  }, [provider, onDeleted, onOpenChange])

  const hasReferences = scan.status === "loaded" && (scan.taskCount + scan.workflowNodeCount + scan.conversationCount) > 0

  return (
    <>
      <AlertDialog open={Boolean(provider)} onOpenChange={onOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除供应商 &ldquo;{provider?.name}&rdquo;</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="flex flex-col gap-2">
                {scan.status === "loading" && <p>正在扫描引用…</p>}
                {scan.status === "error" && <p className="text-destructive">{scan.message}</p>}
                {scan.status === "loaded" && !hasReferences && <p>该供应商未被任何内容引用，可以安全删除。</p>}
                {scan.status === "loaded" && hasReferences && (
                  <>
                    <p>该供应商被以下内容引用：</p>
                    {scan.taskCount > 0 && (
                      <div>
                        <p className="font-medium">定时任务 ({scan.taskCount})</p>
                        <ul className="ml-4 list-disc text-sm text-muted-foreground">
                          {scan.references.filter((r) => r.kind === "scheduled-task").map((r, i) => (
                            <li key={i}>{r.entityName}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {scan.workflowNodeCount > 0 && (
                      <div>
                        <p className="font-medium">工作流节点 ({scan.workflowNodeCount})</p>
                        <ul className="ml-4 list-disc text-sm text-muted-foreground">
                          {scan.references.filter((r) => r.kind === "workflow-node").map((r, i) => (
                            <li key={i}>{r.entityName}{r.nodeName ? ` → ${r.nodeName}` : ""}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {scan.conversationCount > 0 && (
                      <div>
                        <p className="font-medium">Agent 会话 ({scan.conversationCount})</p>
                        <p className="ml-4 text-sm text-muted-foreground">不迁移，仅标记失效</p>
                      </div>
                    )}
                  </>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            {hasReferences && (
              <Button variant="outline" disabled={busy} onClick={() => setMigrationOpen(true)}>
                迁移到其他供应商
              </Button>
            )}
            <Button variant="destructive" disabled={busy || scan.status === "loading"} onClick={handleDelete}>
              {hasReferences ? "仍然删除" : "确认删除"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <ProviderModelSelectDialog
        open={migrationOpen}
        onOpenChange={setMigrationOpen}
        onSelect={handleMigrate}
      />
    </>
  )
}
```

- [ ] **Step 2: Integrate into provider-panel.tsx**

In `provider-panel.tsx`:
1. Import `ProviderDeleteDialog`
2. Add state: `const [deletingProvider, setDeletingProvider] = useState<SynapseAgentProvider | null>(null)`
3. Add `onDelete={setDeletingProvider}` to `ProviderPanelView` props
4. Render `<ProviderDeleteDialog provider={deletingProvider} onOpenChange={(open) => { if (!open) setDeletingProvider(null) }} onDeleted={() => void refresh()} />`
5. In `ProviderRowActions`, add a "删除" action button next to "归档"

- [ ] **Step 3: Verify compilation**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No type errors

- [ ] **Step 4: Commit**

```bash
git add src/modules/settings/components/provider-delete-dialog.tsx src/modules/settings/components/provider-panel.tsx
git commit -m "feat(settings): add provider delete dialog with migration wizard"
```

---

## Task 7: Tier Warning Display

**Files:**
- Modify: `workflow-nodes/prompt/panel.tsx`
- Modify: `workflow-nodes/switch/panel.tsx`
- Modify: `src/modules/agent/index.tsx`

Note: `TaskCard` tier warning requires understanding how `TaskCard` currently displays provider info. Check if it renders provider name and where.

- [ ] **Step 1: Add warning to PromptNodePanel**

In `workflow-nodes/prompt/panel.tsx`, after resolving provider name, call `validateProviderReference` and conditionally show a warning tooltip on the provider button:

```typescript
import { validateProviderReference } from "@/lib/provider-reference-validation"
// ... use it to check config.providerId + config.modelTier against the provider list from useProviderLookup context
// If degraded or invalid, add a destructive variant or tooltip text
```

The exact integration depends on how `useProviderLookup` exposes the provider list. Add `allProviders` to the context if needed for archived detection.

- [ ] **Step 2: Add warning to SwitchNodePanel**

Same pattern as PromptNodePanel.

- [ ] **Step 3: Add provider warning to Agent header**

In `src/modules/agent/index.tsx`, where `headerProvider` is resolved (around line 277-281), add a check: if `selectedSession?.providerId` is set but `selectedProvider` is undefined (meaning provider was not found in the active list), show a small inline warning badge.

- [ ] **Step 4: Verify compilation**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add workflow-nodes/prompt/panel.tsx workflow-nodes/switch/panel.tsx src/modules/agent/index.tsx
git commit -m "feat(ui): add tier degradation and provider unavailable warnings"
```

---

## Task 8: Archive Guard (reuse Delete Guard for archive flow)

**Files:**
- Modify: `src/modules/settings/components/provider-panel.tsx`

- [ ] **Step 1: Wire archive action through the same scan flow**

In `handleArchive`, before calling `archiveProvider`, first scan references. If references exist, show a simplified warning (no migration needed since archived providers still work at execution time, but UI selection becomes unavailable):

```typescript
const handleArchive = useCallback(async (provider: SynapseAgentProvider) => {
  try {
    const scan = await requireSynapseBridge().agent.scanProviderReferences({ providerId: provider.id })
    const total = scan.taskCount + scan.workflowNodeCount
    if (total > 0) {
      // Show confirmation with reference count
      // Could use a simpler confirm or reuse ProviderDeleteDialog in "archive" mode
    }
    await requireSynapseBridge().agent.archiveProvider({ providerId: provider.id })
    await refresh()
    toast("Provider 已归档")
  } catch (rawError) { /* ... */ }
}, [refresh])
```

A simpler approach: use the browser's confirm or a small AlertDialog that says "该供应商被 N 个定时任务和 M 个工作流引用。归档后这些内容仍可正常执行，但无法在选择列表中看到该供应商。确认归档？"

- [ ] **Step 2: Verify compilation**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No type errors

- [ ] **Step 3: Commit**

```bash
git add src/modules/settings/components/provider-panel.tsx
git commit -m "feat(settings): add archive guard with reference warning"
```

---

## Parallelism Notes

- **Tasks 1 & 2** are independent (backend-only), can run in parallel
- **Task 3** depends on Tasks 1 & 2 (needs the service methods to wire)
- **Task 4** depends on Task 1 (needs `buildEnvSafe` concept, though can be done with try-catch)
- **Task 5** is independent (pure renderer function)
- **Task 6** depends on Task 3 (needs IPC channels)
- **Task 7** depends on Task 5 (needs validation function)
- **Task 8** depends on Task 3 (needs scan IPC)

Optimal ordering: `[1, 2, 5]` → `[3, 4]` → `[6, 7, 8]`
