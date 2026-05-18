# Workflow Provider Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable workflow-level default provider/model + expose provider info via MCP `workflow_node_type_describe`.

**Architecture:** Add `defaultProviderId` + `defaultModelTier` to `WorkflowDefinition`, make node-level fields optional, resolve at engine execution time, validate at save/run time, expose available providers in the `describe` MCP response.

**Tech Stack:** TypeScript, Zod, React, Electron IPC, Vitest

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/types/workflow.ts` | Modify | Add `defaultProviderId?`, `defaultModelTier?` to `WorkflowDefinition` |
| `electron/modules/workflow/ipc.ts:69` | Modify | Add 2 optional fields to `workflowDefinitionSchema` |
| `workflow-nodes/prompt/schema.ts` | Modify | `providerId`/`modelTier` → optional |
| `workflow-nodes/switch/schema.ts` | Modify | `providerId`/`modelTier` → optional |
| `electron/services/workflow/workflow-validator.ts` | Modify | Add provider resolution validation |
| `electron/services/workflow/workflow-engine.ts:119` | Modify | Inject resolved provider/model before executor call |
| `workflow-nodes/panel-registry.ts` | Modify | Add `defaultProviderName?` to `NodePanelProps` |
| `src/modules/workflow/editor/node-config-panel.tsx` | Modify | Pass defaultProviderName + add GlobalSettingsForm provider section |
| `workflow-nodes/prompt/panel.tsx` | Modify | Show "继承" placeholder when no provider set |
| `workflow-nodes/switch/panel.tsx` | Modify | Same |
| `electron/capabilities/workflow-dispatcher.ts` | Modify | Add `listProviders` to deps, attach to describe response |
| `synapse-capabilities/shared/workflow-domain.ts` | Modify | Update describe tool description text |
| `electron/bootstrap/descriptors.ts` | Modify | Inject `listProviders` into dispatcher deps |
| `resources/templates/skills/synapse-workflow/content.md` | Modify | Add provider guidance |
| `resources/templates/skills/synapse-workflow/files/api-reference.md` | Modify | Update describe return shape |

---

### Task 1: Data Layer — Type + IPC Schema

**Files:**
- Modify: `desktop/src/types/workflow.ts:8-13`
- Modify: `desktop/electron/modules/workflow/ipc.ts:66-73`

- [ ] **Step 1: Add fields to WorkflowDefinition**

In `src/types/workflow.ts`, after `defaultProjectId?: string` (line 11), add:

```typescript
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  defaultProjectId?: string
  defaultProviderId?: string
  defaultModelTier?: "default" | "haiku" | "sonnet" | "opus"
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
```

- [ ] **Step 2: Add fields to IPC schema**

In `electron/modules/workflow/ipc.ts`, update `workflowDefinitionSchema`:

```typescript
const workflowDefinitionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  defaultProjectId: z.string().optional(),
  defaultProviderId: z.string().optional(),
  defaultModelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  params: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]), default: z.union([z.string(), z.number(), z.null()]), description: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), config: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() })),
})
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/types/workflow.ts desktop/electron/modules/workflow/ipc.ts
git commit -m "feat(workflow): add defaultProviderId + defaultModelTier to WorkflowDefinition"
```

---

### Task 2: Node Schema — Make Provider Fields Optional

**Files:**
- Modify: `desktop/workflow-nodes/prompt/schema.ts:4-6`
- Modify: `desktop/workflow-nodes/switch/schema.ts:10-12`

- [ ] **Step 1: Update prompt schema**

In `workflow-nodes/prompt/schema.ts`:

```typescript
export const promptNodeConfigSchema = z.object({
  providerId: z.string().optional(),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
})
```

- [ ] **Step 2: Update switch schema**

In `workflow-nodes/switch/schema.ts`:

```typescript
export const switchNodeConfigSchema = z.object({
  providerId: z.string().optional(),
  modelTier: z.enum(["default", "haiku", "sonnet", "opus"]).optional(),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  projectId: z.string().optional(),
  branches: z.array(switchBranchSchema).min(1),
  defaultBranch: z.string().optional(),
})
```

- [ ] **Step 3: Update PromptNodeConfig / SwitchNodeConfig inferred types**

Since these are `z.infer<>` types, they auto-update. But verify that `executor.main.ts` uses them correctly — the typed `config.providerId` is now `string | undefined`. This is addressed in Task 4.

- [ ] **Step 4: Commit**

```bash
git add desktop/workflow-nodes/prompt/schema.ts desktop/workflow-nodes/switch/schema.ts
git commit -m "feat(workflow): make providerId/modelTier optional in node schemas"
```

---

### Task 3: Validator — Provider Resolution Check

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Modify: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `electron/services/__tests__/workflow-validator.test.ts`:

```typescript
it("errors when prompt node has no providerId and workflow has no default", () => {
  const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "hi" } }
  const r = validateWorkflow({ ...base, nodes: [nodeNoProvider, nodeEnd], edges: [{ id: "e1", from: "np", to: "end" }] })
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "np" && e.message.includes("供应商"))).toBe(true)
})

it("errors when prompt node has no modelTier and workflow has no default", () => {
  const nodeNoTier = { id: "nt", name: "NT", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", variables: [], prompt: "hi" } }
  const r = validateWorkflow({ ...base, nodes: [nodeNoTier, nodeEnd], edges: [{ id: "e1", from: "nt", to: "end" }] })
  expect(r.valid).toBe(false)
  expect(r.errors.some((e) => e.type === "invalid_config" && e.nodeId === "nt" && e.message.includes("模型"))).toBe(true)
})

it("passes when node omits provider but workflow has defaultProviderId + defaultModelTier", () => {
  const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "hi" } }
  const defWithDefault = { ...base, defaultProviderId: "test-provider", defaultModelTier: "sonnet" as const, nodes: [nodeNoProvider, nodeEnd], edges: [{ id: "e1", from: "np", to: "end" }] }
  const r = validateWorkflow(defWithDefault)
  expect(r.valid).toBe(true)
})

it("passes when switch node omits provider but workflow has defaults", () => {
  const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
  const defWithDefault = { ...base, defaultProviderId: "test-provider", defaultModelTier: "sonnet" as const, nodes: [sw, nodeB, nodeEnd], edges: [{ id: "e1", from: "sw", to: "b", branch: "yes" }, { id: "e2", from: "b", to: "end" }] }
  const r = validateWorkflow(defWithDefault)
  expect(r.valid).toBe(true)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && pnpm vitest run electron/services/__tests__/workflow-validator.test.ts`

Expected: New tests fail (the "no provider" nodes now pass Zod schema since fields are optional, but validator doesn't yet check fallback).

- [ ] **Step 3: Implement provider validation**

In `workflow-validator.ts`, after the `configSchema.safeParse` block (around line 100-104), add provider resolution check for prompt/switch nodes:

```typescript
    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const parsed = manifest.configSchema.safeParse(node.config)
      if (!parsed.success) errors.push({ type: "invalid_config", nodeId: node.id, message: parsed.error.message })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      errors.push({ type: "invalid_config", nodeId: node.id, message: `节点 "${node.name}" 类型无效：${message}` })
    }

    // Provider resolution: prompt/switch nodes must have provider either on node or workflow default
    if (node.type === "prompt" || node.type === "switch") {
      const cfg = node.config as Record<string, unknown>
      const hasProviderId = typeof cfg.providerId === "string" && cfg.providerId.length > 0
      const hasModelTier = typeof cfg.modelTier === "string" && cfg.modelTier.length > 0
      if (!hasProviderId && !def.defaultProviderId) {
        errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」未配置供应商，且工作流未设置默认供应商` })
      }
      if (!hasModelTier && !def.defaultModelTier) {
        errors.push({ type: "invalid_config", nodeId: node.id, message: `节点「${node.name}」未配置模型层级，且工作流未设置默认模型` })
      }
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && pnpm vitest run electron/services/__tests__/workflow-validator.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): validate provider resolution for prompt/switch nodes"
```

---

### Task 4: Engine — Inject Resolved Provider at Execution Time

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-engine.ts:119`
- Modify: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Write failing test**

Add to `electron/services/__tests__/workflow-engine.test.ts`:

```typescript
it("resolves provider from workflow default when node omits it", async () => {
  const nodeNoProvider = { id: "np", name: "NP", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "test" } }
  const def: WorkflowDefinition = {
    id: "wf-default-provider", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
    defaultProviderId: "resolved-provider", defaultModelTier: "opus" as const,
    params: [],
    nodes: [nodeNoProvider, nodeEnd],
    edges: [{ id: "e1", from: "np", to: "end" }],
  }
  const agent = fakeAgent("ok")
  const engine = new WorkflowEngine(agent)
  await engine.run(def, {}, "run-resolve", () => {})
  expect(agent.sendToAgent).toHaveBeenCalledWith(
    expect.objectContaining({ providerId: "resolved-provider", modelTier: "opus" }),
  )
})

it("node-level provider takes priority over workflow default", async () => {
  const nodeWithProvider = { id: "wp", name: "WP", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "node-provider", modelTier: "haiku", variables: [], prompt: "test" } }
  const def: WorkflowDefinition = {
    id: "wf-override", name: "WF", version: "v1", createdAt: 0, updatedAt: 0,
    defaultProviderId: "wf-provider", defaultModelTier: "opus" as const,
    params: [],
    nodes: [nodeWithProvider, nodeEnd],
    edges: [{ id: "e1", from: "wp", to: "end" }],
  }
  const agent = fakeAgent("ok")
  const engine = new WorkflowEngine(agent)
  await engine.run(def, {}, "run-override", () => {})
  expect(agent.sendToAgent).toHaveBeenCalledWith(
    expect.objectContaining({ providerId: "node-provider", modelTier: "haiku" }),
  )
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd desktop && pnpm vitest run electron/services/__tests__/workflow-engine.test.ts`

Expected: First test fails because `sendToAgent` receives `undefined` for providerId/modelTier.

- [ ] **Step 3: Implement provider resolution in engine**

In `workflow-engine.ts`, after line 119 (`const cfg = manifest.configSchema.parse(node.config)`), add:

```typescript
          const cfg = manifest.configSchema.parse(node.config)

          // Resolve provider fields from workflow defaults for prompt/switch nodes
          if (node.type === "prompt" || node.type === "switch") {
            const c = cfg as Record<string, unknown>
            if (!c.providerId && def.defaultProviderId) c.providerId = def.defaultProviderId
            if (!c.modelTier && def.defaultModelTier) c.modelTier = def.defaultModelTier
          }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd desktop && pnpm vitest run electron/services/__tests__/workflow-engine.test.ts`

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "feat(workflow): resolve provider/model from workflow defaults at execution"
```

---

### Task 5: MCP — Attach Provider List to `workflow_node_type_describe`

**Files:**
- Modify: `desktop/electron/capabilities/workflow-dispatcher.ts:11-19,90-105`
- Modify: `desktop/electron/bootstrap/descriptors.ts:220`
- Modify: `desktop/synapse-capabilities/shared/workflow-domain.ts:58-66`
- Modify: `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`

- [ ] **Step 1: Add `listProviders` to `WorkflowDispatchDeps`**

In `electron/capabilities/workflow-dispatcher.ts`, update the type:

```typescript
export type WorkflowDispatchDeps = {
  workflowService: WorkflowService
  snapshotService: RunSnapshotService
  nodeTypeRegistry: NodeTypeRegistry
  eventBus: EventBus
  listProviders: () => Promise<readonly { id: string; name: string; haikuModel?: string; sonnetModel?: string; opusModel?: string }[]>
  runWorkflow: (id: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
  cancelRun: (runId: string) => void
  cancelRunsForWorkflow: (workflowId: string) => void
  getRunStatus: (runId: string) => Promise<WorkflowRunStatus | null>
}
```

- [ ] **Step 2: Update the `workflow.node_type.describe` handler**

In `workflow-dispatcher.ts`, replace the handler:

```typescript
  "workflow.node_type.describe": async (params, deps) => {
    const nodeType = requireString(params, "nodeType")
    const manifest = deps.nodeTypeRegistry.getManifest(nodeType)
    const configSchema = zodToJsonSchema(manifest.configSchema as unknown as Parameters<typeof zodToJsonSchema>[0])
    const data: Record<string, unknown> = {
      type: manifest.type,
      title: manifest.title,
      color: manifest.color,
      ports: manifest.ports,
      configFields: manifest.configFields,
      configSchema,
    }
    if (nodeType === "prompt" || nodeType === "switch") {
      data.availableProviders = await deps.listProviders()
    }
    return { ok: true, data }
  },
```

- [ ] **Step 3: Inject `listProviders` in bootstrap**

In `electron/bootstrap/descriptors.ts`:

First, add `"provider"` to `coreDatabaseDescriptor.dependsOn` (around line 198) if not already present:

```typescript
  dependsOn: [
    "core.config",
    "core.event-bus",
    "core.task-scheduler",
    "core.action-runtime",
    "core.workflow",
    "core.workflow.snapshots",
    "core.workflow.run-aborts",
    "core.workflow.run-statuses",
    "core.workflow.engine",
    "provider",
  ],
```

Then in the `create(ctx)` function, before `createWorkflowDispatcher(...)` (around line 219), add:

```typescript
    const providerService = ctx.registry.get<ProviderService>("provider")
```

And inject `listProviders` into the dispatcher call:

```typescript
    const workflowDispatcher = createWorkflowDispatcher({
      workflowService,
      snapshotService,
      nodeTypeRegistry,
      eventBus,
      listProviders: async () => {
        const providers = await providerService.listProviders()
        return providers.map((p) => ({
          id: p.id,
          name: p.name,
          haikuModel: p.haikuModel || undefined,
          sonnetModel: p.sonnetModel || undefined,
          opusModel: p.opusModel || undefined,
        }))
      },
      runWorkflow: async (id, params) => { /* existing code unchanged */ },
      // ... rest unchanged
    })
```

The `ProviderService` type is already imported at the top of the file (line 52):

```typescript
import {
  createProviderProjectService,
  createProviderServiceFromDataRepository,
  PROVIDER_SERVICE_ID,
  type ProviderService,
} from "../services/provider"
```

- [ ] **Step 4: Update tool description**

In `synapse-capabilities/shared/workflow-domain.ts`, line ~60:

```typescript
    {
      name: "workflow_node_type_describe",
      description: "Return the full manifest for a node type including config JSON Schema, port definitions, and field descriptors. For prompt and switch nodes, also returns availableProviders with id, name, and model mappings per tier.",
      inputSchema: {
        type: "object",
        properties: { nodeType: { type: "string", description: "Node type identifier (e.g. \"prompt\", \"switch\", \"end\")." } },
        required: ["nodeType"],
      },
    },
```

- [ ] **Step 5: Update dispatcher test**

In `electron/capabilities/__tests__/workflow-dispatcher.test.ts`, update `makeDeps` to include `listProviders`:

```typescript
function makeDeps(overrides: Partial<WorkflowDispatchDeps> = {}): WorkflowDispatchDeps {
  return {
    // ... existing ...
    listProviders: vi.fn(async () => [{ id: "prov-1", name: "TestProvider", haikuModel: "m1", sonnetModel: "m2", opusModel: "m3" }]),
    ...overrides,
  }
}
```

Add a test:

```typescript
  it("workflow.node_type.describe returns availableProviders for prompt", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "prompt" }, { source: "api" })
    expect(result.ok).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data.availableProviders).toEqual([{ id: "prov-1", name: "TestProvider", haikuModel: "m1", sonnetModel: "m2", opusModel: "m3" }])
    expect(deps.listProviders).toHaveBeenCalled()
  })

  it("workflow.node_type.describe does not include availableProviders for end", async () => {
    const deps = makeDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.describe", { nodeType: "end" }, { source: "api" })
    expect(result.ok).toBe(true)
    const data = result.data as Record<string, unknown>
    expect(data.availableProviders).toBeUndefined()
    expect(deps.listProviders).not.toHaveBeenCalled()
  })
```

- [ ] **Step 6: Run tests**

Run: `cd desktop && pnpm vitest run electron/capabilities/__tests__/workflow-dispatcher.test.ts`

Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/capabilities/workflow-dispatcher.ts desktop/electron/bootstrap/descriptors.ts desktop/synapse-capabilities/shared/workflow-domain.ts desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
git commit -m "feat(workflow): attach availableProviders to node_type_describe for prompt/switch"
```

---

### Task 6: UI — Global Settings Provider Selection

**Files:**
- Modify: `desktop/workflow-nodes/panel-registry.ts:8-15`
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx:147,155-233`

- [ ] **Step 1: Add `defaultProviderName` to `NodePanelProps`**

In `workflow-nodes/panel-registry.ts`:

```typescript
export interface NodePanelProps {
  config: Record<string, unknown>
  onChange: (config: Record<string, unknown>) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderName?: string
}
```

- [ ] **Step 2: Compute and pass `defaultProviderName` in `NodeConfigPanel`**

In `node-config-panel.tsx`, import `useProviderLookup` and pass the prop:

```typescript
import { useProviderLookup } from "../../../../workflow-nodes/provider-lookup-context"
```

Inside `NodeConfigPanel`, before the return:

```typescript
const { getProviderName, getModelName } = useProviderLookup()
const defaultProviderName = definition.defaultProviderId
  ? (getProviderName(definition.defaultProviderId) ?? definition.defaultProviderId)
  : undefined
const defaultProviderLabel = defaultProviderName && definition.defaultModelTier
  ? `${defaultProviderName} · ${definition.defaultModelTier}`
  : defaultProviderName
```

And pass it in the PanelComponent render:

```typescript
<PanelComponent
  key={node.id}
  config={node.config}
  onChange={(c) => onConfigChange(node.id, c)}
  upstreamNodes={upstreamNodes}
  workflowParams={definition.params}
  projects={projects}
  defaultProjectName={defaultProjectName}
  defaultProviderName={defaultProviderLabel}
/>
```

- [ ] **Step 3: Add provider selection to `GlobalSettingsForm`**

In the `GlobalSettingsForm` component, after the "默认项目" section, add:

```typescript
import { ProviderModelSelectDialog } from "@/components/provider-model-select-dialog"
import type { ProviderModelSelection } from "@/types/provider-model"
```

Inside the form, after the project Select and before the Separator:

```typescript
        <div className="space-y-1.5">
          <Label className="text-xs">默认供应商</Label>
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              className="flex-1 justify-between h-7 text-xs"
              onClick={() => setProviderDialogOpen(true)}
            >
              <span className="truncate">
                {definition.defaultProviderId
                  ? `${definition.defaultProviderId} · ${definition.defaultModelTier ?? "default"}`
                  : "未设置"}
              </span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </Button>
            {definition.defaultProviderId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                onClick={() => onChange?.({ ...definition, defaultProviderId: undefined, defaultModelTier: undefined })}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
          <ProviderModelSelectDialog
            open={providerDialogOpen}
            onOpenChange={setProviderDialogOpen}
            defaultSelection={definition.defaultProviderId ? { providerId: definition.defaultProviderId, modelTier: (definition.defaultModelTier ?? "default") as any } : undefined}
            onSelect={(s: ProviderModelSelection) => onChange?.({ ...definition, defaultProviderId: s.providerId, defaultModelTier: s.modelTier })}
          />
        </div>
```

Add state in `GlobalSettingsForm`:

```typescript
const [providerDialogOpen, setProviderDialogOpen] = useState(false)
```

Add imports: `ChevronDown`, `X` from `lucide-react`.

- [ ] **Step 4: Commit**

```bash
git add desktop/workflow-nodes/panel-registry.ts desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "feat(workflow): add default provider selection to workflow global settings"
```

---

### Task 7: UI — Node Panel "继承" Placeholder

**Files:**
- Modify: `desktop/workflow-nodes/prompt/panel.tsx`
- Modify: `desktop/workflow-nodes/switch/panel.tsx`

- [ ] **Step 1: Update PromptNodePanel props and display**

In `prompt/panel.tsx`, update `PromptNodePanelProps`:

```typescript
export interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderName?: string
}
```

Update the function signature to destructure `defaultProviderName`:

```typescript
export function PromptNodePanel({ config, onChange, upstreamNodes, workflowParams, projects, defaultProjectName, defaultProviderName }: PromptNodePanelProps) {
```

Update the provider button label (around line 48-50):

```typescript
            {config.providerId
              ? `${getProviderName(config.providerId) ?? config.providerId} · ${getModelName(config.providerId, config.modelTier!) ?? TIER_LABELS[config.modelTier!] ?? config.modelTier}`
              : defaultProviderName ? `继承: ${defaultProviderName}` : "选择供应商 + 模型"}
```

Note: `config.modelTier` is now `string | undefined`, so use `!` assertion or handle undefined in the display logic. Since we're displaying, fallback gracefully:

```typescript
            {config.providerId
              ? `${getProviderName(config.providerId) ?? config.providerId} · ${config.modelTier ? (getModelName(config.providerId, config.modelTier) ?? TIER_LABELS[config.modelTier] ?? config.modelTier) : ""}`
              : defaultProviderName ? `继承: ${defaultProviderName}` : "选择供应商 + 模型"}
```

- [ ] **Step 2: Update SwitchNodePanel similarly**

In `switch/panel.tsx`, update `SwitchNodePanelProps`:

```typescript
export interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  projects: readonly SynapseProjectConfig[]
  defaultProjectName?: string
  defaultProviderName?: string
}
```

Update function signature and provider button label with same logic as Step 1.

- [ ] **Step 3: Handle optional `modelTier` in `providerUnavailable` check**

Both panels have:

```typescript
const providerUnavailable = Boolean(config.providerId && !isProviderAvailable(config.providerId))
```

This already handles the optional case — if `config.providerId` is `undefined`, `Boolean(undefined && ...)` = `false`. No change needed.

- [ ] **Step 4: Commit**

```bash
git add desktop/workflow-nodes/prompt/panel.tsx desktop/workflow-nodes/switch/panel.tsx
git commit -m "feat(workflow): show '继承' placeholder in node panels when provider inherited"
```

---

### Task 8: Skill File Updates

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-workflow/content.md`
- Modify: `desktop/resources/templates/skills/synapse-workflow/files/api-reference.md`

- [ ] **Step 1: Update content.md**

In `content.md`, in the "Creating a Workflow" section, add guidance after the existing step about calling `workflow_node_type_describe`:

```markdown
3. Call `workflow_node_type_describe` for each node type you plan to use. For `prompt` and `switch` nodes, the response includes `availableProviders` — use one of these IDs when setting `defaultProviderId` on the workflow or `providerId` on individual nodes.
```

Also mention the workflow-level default:

```markdown
**Tip:** Set `defaultProviderId` and `defaultModelTier` at the workflow level to avoid repeating provider config on every node. Individual nodes can override if needed.
```

- [ ] **Step 2: Update api-reference.md**

In the `workflow_node_type_describe` section, update the Returns to:

```markdown
### workflow_node_type_describe

Returns the full manifest for a node type.

**Parameters:**
- `nodeType` (string, required): Node type identifier (e.g. "prompt", "switch", "end")

**Returns:**
- `type`, `title`, `color`, `ports`, `configFields`, `configSchema`
- `availableProviders` (only for prompt/switch): `[{ id, name, haikuModel?, sonnetModel?, opusModel? }]`
```

- [ ] **Step 3: Commit**

```bash
git add desktop/resources/templates/skills/synapse-workflow/content.md desktop/resources/templates/skills/synapse-workflow/files/api-reference.md
git commit -m "docs(workflow): update skill files with provider guidance"
```

---

### Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `cd desktop && pnpm vitest run electron/services/__tests__/workflow-validator.test.ts electron/services/__tests__/workflow-engine.test.ts electron/capabilities/__tests__/workflow-dispatcher.test.ts`

Expected: All pass.

- [ ] **Step 2: Run TypeScript check**

Run: `cd desktop && pnpm tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `cd desktop && pnpm vitest run`

Expected: Full suite passes (existing tests that use `providerId: "test-provider"` still work since the validator only errors when both node and workflow lack provider).
