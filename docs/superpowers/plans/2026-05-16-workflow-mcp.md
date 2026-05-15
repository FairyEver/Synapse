# Workflow MCP Domain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose Synapse workflow CRUD + execution + atomic editing to external Agents via the MCP protocol, with real-time UI reflection.

**Architecture:** Add a `workflow` capability domain following the existing database/scheduler pattern: capability definitions in `synapse-capabilities/shared/workflow-domain.ts`, a dispatcher in `electron/capabilities/workflow-dispatcher.ts`, and wiring through `action-router` + bootstrap. The dispatcher delegates to existing `WorkflowService`, `RunSnapshotService`, `NodeTypeRegistry`, and in-memory run status maps. Write operations emit `workflow:definition-updated` on EventBus so the editor can refresh in real time.

**Tech Stack:** TypeScript, Zod, zod-to-json-schema, Vitest

**Spec:** `docs/superpowers/specs/2026-05-16-workflow-mcp-design.md`

---

## File Map

### New files

| File | Responsibility |
|---|---|
| `desktop/synapse-capabilities/shared/workflow-domain.ts` | 18 capability definitions + 18 MCP tool schemas + builder functions |
| `desktop/electron/capabilities/workflow-dispatcher.ts` | Action → service dispatch for all 18 workflow actions |
| `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts` | Dispatcher unit tests |
| `desktop/docs/workflow-mcp-guide.md` | Optional skill/rule reference doc for Agents |

### Modified files

| File | Change |
|---|---|
| `desktop/synapse-capabilities/shared/registry.ts` | Import + register `WORKFLOW_DOMAIN`, `WORKFLOW_MCP_TOOL_ACTIONS`, `buildWorkflowTools` |
| `desktop/electron/capabilities/action-router.ts` | Add `workflowDispatch` to deps, route `workflow` domain |
| `desktop/electron/capabilities/__tests__/action-router.test.ts` | Add workflow routing test |
| `desktop/electron/bootstrap/descriptors.ts` | Wire `createWorkflowDispatcher` into `coreDatabaseDescriptor` action router |
| `desktop/src/modules/workflow/editor/editor-app.tsx` | Listen for `workflow:definition-updated` EventBus event, reload definition |

---

## Task 1: Install `zod-to-json-schema`

**Files:**
- Modify: `desktop/package.json`

- [ ] **Step 1: Install the dependency**

```bash
pnpm --filter @synapse/desktop add zod-to-json-schema
```

- [ ] **Step 2: Verify installation**

```bash
pnpm --filter @synapse/desktop exec node -e "require('zod-to-json-schema')"
```

Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add desktop/package.json pnpm-lock.yaml
git commit -m "chore: add zod-to-json-schema dependency"
```

---

## Task 2: Capability definitions — `workflow-domain.ts`

**Files:**
- Create: `desktop/synapse-capabilities/shared/workflow-domain.ts`

- [ ] **Step 1: Write the capability definitions and MCP tool schemas**

Create `desktop/synapse-capabilities/shared/workflow-domain.ts` with the following content:

```typescript
import type { CapabilityDefinition, CapabilityDomainDefinition, McpToolDefinition } from "./types"
import type { CapabilityId } from "./naming"
import { capabilityIdToMcpTool } from "./naming"

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------

const workflowCapabilities: readonly CapabilityDefinition[] = [
  // Discovery
  { id: "workflow.node_type.list" as CapabilityId, title: "List node types", description: "List available workflow node types with summaries.", mutates: false },
  { id: "workflow.node_type.describe" as CapabilityId, title: "Describe node type", description: "Return full manifest + config JSON Schema for a node type.", mutates: false },
  // Read
  { id: "workflow.definition.list" as CapabilityId, title: "List workflows", description: "List all workflow definitions.", mutates: false },
  { id: "workflow.definition.get" as CapabilityId, title: "Get workflow", description: "Get a full workflow definition by ID.", mutates: false },
  { id: "workflow.definition.inspect" as CapabilityId, title: "Inspect workflow", description: "Validate a workflow definition and return errors/warnings.", mutates: false },
  { id: "workflow.run.get" as CapabilityId, title: "Get run status", description: "Get workflow run status by runId.", mutates: false },
  { id: "workflow.run.list" as CapabilityId, title: "List run history", description: "List run history for a workflow.", mutates: false },
  // Whole write
  { id: "workflow.definition.create" as CapabilityId, title: "Create workflow", description: "Create a new empty workflow with a default end node.", mutates: true },
  { id: "workflow.definition.update" as CapabilityId, title: "Update workflow", description: "Replace a full workflow definition (validate then save).", mutates: true },
  { id: "workflow.definition.delete" as CapabilityId, title: "Delete workflow", description: "Delete a workflow, cancel active runs, and clean up snapshots.", mutates: true },
  // Execute
  { id: "workflow.run.execute" as CapabilityId, title: "Run workflow", description: "Execute a workflow with parameters. Returns runId for polling.", mutates: true },
  { id: "workflow.run.disable" as CapabilityId, title: "Cancel run", description: "Cancel a running workflow execution.", mutates: true },
  // Atomic write
  { id: "workflow.node.create" as CapabilityId, title: "Add node", description: "Add a node to a workflow. Position is auto-calculated if omitted.", mutates: true },
  { id: "workflow.node.update" as CapabilityId, title: "Update node", description: "Update a node's name, position, or config (config is replaced, not merged).", mutates: true },
  { id: "workflow.node.delete" as CapabilityId, title: "Delete node", description: "Delete a node and its connected edges.", mutates: true },
  { id: "workflow.edge.create" as CapabilityId, title: "Add edge", description: "Add a directed edge between two nodes.", mutates: true },
  { id: "workflow.edge.delete" as CapabilityId, title: "Delete edge", description: "Delete an edge by ID.", mutates: true },
  { id: "workflow.param.update" as CapabilityId, title: "Update params", description: "Replace the workflow parameter list.", mutates: true },
]

export const WORKFLOW_DOMAIN: CapabilityDomainDefinition = {
  id: "workflow",
  capabilities: workflowCapabilities,
}

export const WORKFLOW_MCP_TOOL_ACTIONS: Record<string, string> = Object.fromEntries(
  workflowCapabilities.map((c) => [capabilityIdToMcpTool(c.id), c.id]),
)

// ---------------------------------------------------------------------------
// MCP tool definitions (JSON Schema input schemas)
// ---------------------------------------------------------------------------

const SYSTEM_MODEL_DESCRIPTION = `Synapse workflows are directed acyclic graphs (DAGs). Nodes execute in topological order; independent nodes run in parallel. Every workflow must have exactly one "end" node and no cycles. Nodes connect via directed edges (from → to); switch-node edges may carry a "branch" field. Nodes define a "variables" list that binds upstream node outputs or workflow params; reference them in prompt templates with {{variableName}}. Call this tool first to discover available node types, then call workflow_node_type_describe for config details.`

export function buildWorkflowTools(): McpToolDefinition[] {
  return [
    // Discovery
    {
      name: "workflow_node_type_list",
      description: SYSTEM_MODEL_DESCRIPTION,
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "workflow_node_type_describe",
      description: "Return the full manifest for a node type including config JSON Schema, port definitions, and field descriptors.",
      inputSchema: {
        type: "object",
        properties: { nodeType: { type: "string", description: "Node type identifier (e.g. \"prompt\", \"switch\", \"end\")." } },
        required: ["nodeType"],
      },
    },
    // Read
    {
      name: "workflow_definition_list",
      description: "List all workflow definitions with metadata (id, name, description, version, nodeCount, timestamps).",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
    {
      name: "workflow_definition_get",
      description: "Get the full workflow definition JSON by workflow ID. Returns null if not found.",
      inputSchema: {
        type: "object",
        properties: { workflowId: { type: "string", description: "Workflow ID." } },
        required: ["workflowId"],
      },
    },
    {
      name: "workflow_definition_inspect",
      description: "Validate a workflow definition and return { valid, errors, warnings }.",
      inputSchema: {
        type: "object",
        properties: { definition: { type: "object", description: "Full WorkflowDefinition object to validate." } },
        required: ["definition"],
      },
    },
    {
      name: "workflow_run_get",
      description: "Get workflow run status by runId. Returns run status including per-node results, or null if not found. Check in-memory statuses first, then fall back to snapshot on disk.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Run ID returned by workflow_run_execute." } },
        required: ["runId"],
      },
    },
    {
      name: "workflow_run_list",
      description: "List run history (snapshots) for a workflow, newest first.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          limit: { type: "number", description: "Maximum entries to return. Defaults to 20." },
        },
        required: ["workflowId"],
      },
    },
    // Whole write
    {
      name: "workflow_definition_create",
      description: "Create a new empty workflow with a default end node. Returns { id, versionHash }.",
      inputSchema: {
        type: "object",
        properties: { name: { type: "string", description: "Optional workflow name. Defaults to \"新工作流\"." } },
      },
    },
    {
      name: "workflow_definition_update",
      description: "Replace a full workflow definition. The definition must include the workflow id. Validates before saving. Returns { versionHash } on success or { errors } on validation failure.",
      inputSchema: {
        type: "object",
        properties: { definition: { type: "object", description: "Full WorkflowDefinition object including id." } },
        required: ["definition"],
      },
    },
    {
      name: "workflow_definition_delete",
      description: "Delete a workflow by ID. Cancels any active runs and removes run snapshots.",
      inputSchema: {
        type: "object",
        properties: { workflowId: { type: "string", description: "Workflow ID to delete." } },
        required: ["workflowId"],
      },
    },
    // Execute
    {
      name: "workflow_run_execute",
      description: "Execute a workflow with the given parameters. Returns { runId } on success. Use workflow_run_get to poll for completion.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID to execute." },
          params: { type: "object", description: "Key-value parameters matching the workflow's param definitions." },
        },
        required: ["workflowId"],
      },
    },
    {
      name: "workflow_run_disable",
      description: "Cancel a running workflow execution by sending an abort signal.",
      inputSchema: {
        type: "object",
        properties: { runId: { type: "string", description: "Run ID to cancel." } },
        required: ["runId"],
      },
    },
    // Atomic write
    {
      name: "workflow_node_create",
      description: "Add a node to a workflow. Position is auto-calculated if omitted. Validates the modified definition before saving.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          node: {
            type: "object",
            description: "Node specification.",
            properties: {
              name: { type: "string", description: "Display name for the node." },
              type: { type: "string", description: "Node type (e.g. \"prompt\", \"switch\", \"end\")." },
              position: { type: "object", description: "Optional { x, y } position. Auto-calculated if omitted.", properties: { x: { type: "number" }, y: { type: "number" } } },
              config: { type: "object", description: "Node configuration. Use workflow_node_type_describe to see required fields." },
            },
            required: ["name", "type"],
          },
        },
        required: ["workflowId", "node"],
      },
    },
    {
      name: "workflow_node_update",
      description: "Update a node's name, position, or config. Config is replaced entirely (not merged). Validates after update.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          nodeId: { type: "string", description: "Node ID to update." },
          patch: {
            type: "object",
            description: "Fields to update. Only provided fields are changed.",
            properties: {
              name: { type: "string" },
              position: { type: "object", properties: { x: { type: "number" }, y: { type: "number" } } },
              config: { type: "object", description: "Replaces the entire config object." },
            },
          },
        },
        required: ["workflowId", "nodeId", "patch"],
      },
    },
    {
      name: "workflow_node_delete",
      description: "Delete a node and all its connected edges. Cannot delete the end node. Returns { versionHash, removedEdgeCount }.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          nodeId: { type: "string", description: "Node ID to delete." },
        },
        required: ["workflowId", "nodeId"],
      },
    },
    {
      name: "workflow_edge_create",
      description: "Add a directed edge between two nodes. For switch nodes, include a branch field.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          from: { type: "string", description: "Source node ID." },
          to: { type: "string", description: "Target node ID." },
          branch: { type: "string", description: "Optional branch name for switch node edges." },
        },
        required: ["workflowId", "from", "to"],
      },
    },
    {
      name: "workflow_edge_delete",
      description: "Delete an edge by its ID.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          edgeId: { type: "string", description: "Edge ID to delete." },
        },
        required: ["workflowId", "edgeId"],
      },
    },
    {
      name: "workflow_param_update",
      description: "Replace the workflow's parameter list entirely. Pass an empty array to clear all params.",
      inputSchema: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "Workflow ID." },
          params: {
            type: "array",
            description: "New parameter list.",
            items: {
              type: "object",
              properties: {
                name: { type: "string" },
                type: { type: "string", enum: ["text", "number"] },
                default: { description: "Default value. String for text, number for number, or null." },
                description: { type: "string" },
              },
              required: ["name", "type"],
            },
          },
        },
        required: ["workflowId", "params"],
      },
    },
  ]
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit -p tsconfig.electron.json 2>&1 | head -20
```

Expected: no errors related to `workflow-domain.ts`.

- [ ] **Step 3: Commit**

```bash
git add desktop/synapse-capabilities/shared/workflow-domain.ts
git commit -m "feat(workflow-mcp): add workflow capability definitions and MCP tool schemas"
```

---

## Task 3: Register workflow domain in the capability registry

**Files:**
- Modify: `desktop/synapse-capabilities/shared/registry.ts`

- [ ] **Step 1: Add workflow imports and registration**

Add to imports at the top of `registry.ts`:

```typescript
import {
  WORKFLOW_DOMAIN,
  WORKFLOW_MCP_TOOL_ACTIONS,
  buildWorkflowTools,
} from "./workflow-domain"
```

Then update the three exports:

```typescript
export const CAPABILITY_DOMAINS: readonly CapabilityDomainDefinition[] = [
  DATABASE_DOMAIN,
  SCHEDULER_DOMAIN,
  WORKFLOW_DOMAIN,
]

export const MCP_TOOL_ACTIONS: Record<string, string> = {
  ...buildDatabaseMcpToolActions(),
  ...SCHEDULER_MCP_TOOL_ACTIONS,
  ...WORKFLOW_MCP_TOOL_ACTIONS,
}

export function buildAllMcpTools(): McpToolDefinition[] {
  return [
    ...buildDatabaseTools(),
    ...buildSchedulerTools(),
    ...buildWorkflowTools(),
  ]
}
```

- [ ] **Step 2: Verify compilation**

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit -p tsconfig.electron.json 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add desktop/synapse-capabilities/shared/registry.ts
git commit -m "feat(workflow-mcp): register workflow domain in capability registry"
```

---

## Task 4: Workflow dispatcher

This is the largest task. The dispatcher maps all 18 action IDs to service calls.

**Files:**
- Create: `desktop/electron/capabilities/workflow-dispatcher.ts`
- Test: `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`

- [ ] **Step 1: Write the dispatcher tests**

Create `desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"
import { createWorkflowDispatcher, type WorkflowDispatchDeps } from "../workflow-dispatcher"

function createMockDeps(overrides: Partial<WorkflowDispatchDeps> = {}): WorkflowDispatchDeps {
  return {
    workflowService: {
      list: vi.fn(async () => []),
      get: vi.fn(async () => null),
      save: vi.fn(async () => ({ versionHash: "v_test" })),
      create: vi.fn(async () => ({ id: "wf-1", versionHash: "v_test" })),
      delete: vi.fn(async () => undefined),
    } as unknown as WorkflowDispatchDeps["workflowService"],
    snapshotService: {
      list: vi.fn(async () => []),
      findByRunId: vi.fn(async () => null),
      deleteWorkflow: vi.fn(async () => undefined),
    } as unknown as WorkflowDispatchDeps["snapshotService"],
    nodeTypeRegistry: {
      listTypes: vi.fn(() => ["prompt", "switch", "end"]),
      getManifest: vi.fn(() => ({
        type: "prompt",
        title: "AI 对话",
        configSchema: { _def: {} },
        ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
        configFields: [{ name: "prompt", kind: "text", label: "Prompt" }],
      })),
    } as unknown as WorkflowDispatchDeps["nodeTypeRegistry"],
    eventBus: { emit: vi.fn() } as unknown as WorkflowDispatchDeps["eventBus"],
    runWorkflow: vi.fn(async () => ({ runId: "run-1" })),
    cancelRun: vi.fn(),
    getRunStatus: vi.fn(async () => null),
    ...overrides,
  }
}

describe("workflow dispatcher", () => {
  it("dispatches workflow.definition.list", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.list", {}, {})
    expect(result.ok).toBe(true)
    expect(deps.workflowService.list).toHaveBeenCalled()
  })

  it("dispatches workflow.definition.create", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.create", {}, {})
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: "wf-1", versionHash: "v_test" })
  })

  it("dispatches workflow.definition.get returns null for missing", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.definition.get", { workflowId: "missing" }, {})
    expect(result.ok).toBe(true)
    expect(result.data).toBeNull()
  })

  it("dispatches workflow.node_type.list", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node_type.list", {}, {})
    expect(result.ok).toBe(true)
    expect(Array.isArray(result.data)).toBe(true)
  })

  it("dispatches workflow.run.execute", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.execute", { workflowId: "wf-1" }, {})
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ runId: "run-1" })
  })

  it("dispatches workflow.run.disable", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.run.disable", { runId: "run-1" }, {})
    expect(result.ok).toBe(true)
    expect(deps.cancelRun).toHaveBeenCalledWith("run-1")
  })

  it("dispatches workflow.node.create with auto-position", async () => {
    const mockDef = {
      id: "wf-1", name: "test", version: "v1", createdAt: 0, updatedAt: 0,
      params: [],
      nodes: [{ id: "n1", name: "End", type: "end", position: { x: 600, y: 200 }, config: { outputType: "text", template: "", variables: [] } }],
      edges: [],
    }
    const deps = createMockDeps({
      workflowService: {
        list: vi.fn(),
        get: vi.fn(async () => mockDef),
        save: vi.fn(async () => ({ versionHash: "v_new" })),
        create: vi.fn(),
        delete: vi.fn(),
      } as unknown as WorkflowDispatchDeps["workflowService"],
    })
    const dispatcher = createWorkflowDispatcher(deps)
    const result = await dispatcher.dispatch("workflow.node.create", {
      workflowId: "wf-1",
      node: { name: "AI", type: "prompt" },
    }, {})
    expect(result.ok).toBe(true)
    expect((result.data as Record<string, unknown>).nodeId).toBeDefined()
    expect((result.data as Record<string, unknown>).versionHash).toBe("v_new")
    // Verify auto-positioned
    const savedDef = (deps.workflowService.save as ReturnType<typeof vi.fn>).mock.calls[0][0]
    const newNode = savedDef.nodes.find((n: { name: string }) => n.name === "AI")
    expect(newNode.position.x).toBe(850) // 600 + 250
    expect(newNode.position.y).toBe(200) // average of existing
  })

  it("throws on unknown action", async () => {
    const deps = createMockDeps()
    const dispatcher = createWorkflowDispatcher(deps)
    await expect(dispatcher.dispatch("workflow.bogus.action", {}, {})).rejects.toThrow(/Unknown/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/workflow-dispatcher.test.ts 2>&1 | tail -20
```

Expected: FAIL — `workflow-dispatcher` module does not exist yet.

- [ ] **Step 3: Write the dispatcher implementation**

Create `desktop/electron/capabilities/workflow-dispatcher.ts`:

```typescript
import { randomUUID } from "node:crypto"
import type { WorkflowService, WorkflowSaveResult, WorkflowSaveError } from "../services/workflow/workflow-service"
import type { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import type { NodeTypeRegistry } from "../../workflow-nodes/registry"
import type { EventBus } from "../runtime/event-bus"
import type { WorkflowDefinition, WorkflowRunStatus, ValidationError } from "../../src/types/workflow"
import type { DispatchContext, DispatchResult } from "../../synapse-capabilities/shared/types"
import { validateWorkflow } from "../services/workflow/workflow-validator"
import { zodToJsonSchema } from "zod-to-json-schema"

export type WorkflowDispatchDeps = {
  workflowService: WorkflowService
  snapshotService: RunSnapshotService
  nodeTypeRegistry: NodeTypeRegistry
  eventBus: EventBus
  runWorkflow: (id: string, params: Record<string, unknown>) => Promise<{ runId: string } | { errors: ValidationError[] }>
  cancelRun: (runId: string) => void
  getRunStatus: (runId: string) => Promise<WorkflowRunStatus | null>
}

type ActionHandler = (params: Record<string, unknown>) => unknown | Promise<unknown>

export function createWorkflowDispatcher(deps: WorkflowDispatchDeps) {
  function ok(data?: unknown): DispatchResult { return { ok: true, data } }

  function emitDefinitionUpdated(workflowId: string, versionHash: string): void {
    deps.eventBus.emit(
      { domain: "workflow", type: "workflow:definition-updated", payload: { workflowId, source: "mcp", versionHash }, timestamp: new Date().toISOString() },
      { backpressure: "drop" },
    )
  }

  function autoPosition(nodes: WorkflowDefinition["nodes"]): { x: number; y: number } {
    if (nodes.length === 0) return { x: 200, y: 200 }
    const maxX = Math.max(...nodes.map((n) => n.position.x))
    const avgY = nodes.reduce((sum, n) => sum + n.position.y, 0) / nodes.length
    return { x: maxX + 250, y: Math.round(avgY) }
  }

  async function atomicMutate(
    workflowId: string,
    mutate: (def: WorkflowDefinition) => { result?: Record<string, unknown> },
  ): Promise<DispatchResult> {
    const def = await deps.workflowService.get(workflowId)
    if (!def) throw new Error(`Workflow not found: ${workflowId}`)
    const { result } = mutate(def)
    const validation = validateWorkflow(def)
    if (!validation.valid) return ok({ errors: validation.errors })
    const saveResult = await deps.workflowService.save(def) as WorkflowSaveResult | WorkflowSaveError
    if ("errors" in saveResult) return ok({ errors: saveResult.errors })
    emitDefinitionUpdated(workflowId, saveResult.versionHash)
    return ok({ ...result, versionHash: saveResult.versionHash })
  }

  const handlers: Record<string, ActionHandler> = {
    // Discovery
    "workflow.node_type.list": () => {
      return deps.nodeTypeRegistry.listTypes().map((type) => {
        const m = deps.nodeTypeRegistry.getManifest(type)
        return { type: m.type, title: m.title, description: m.cardSummary(m.configSchema.parse ? {} : {}).title ?? m.title }
      })
    },
    "workflow.node_type.describe": (params) => {
      const { nodeType } = params as { nodeType: string }
      const m = deps.nodeTypeRegistry.getManifest(nodeType)
      let configSchema: unknown = {}
      try { configSchema = zodToJsonSchema(m.configSchema) } catch { /* fallback */ }
      return {
        type: m.type,
        title: m.title,
        ports: m.ports,
        configSchema,
        configFields: m.configFields,
      }
    },
    // Read
    "workflow.definition.list": async () => deps.workflowService.list(),
    "workflow.definition.get": async (params) => {
      const { workflowId } = params as { workflowId: string }
      return deps.workflowService.get(workflowId)
    },
    "workflow.definition.inspect": (params) => {
      const { definition } = params as { definition: WorkflowDefinition }
      return validateWorkflow(definition)
    },
    "workflow.run.get": async (params) => {
      const { runId } = params as { runId: string }
      const inMemory = await deps.getRunStatus(runId)
      if (inMemory) return inMemory
      return deps.snapshotService.findByRunId(runId)
    },
    "workflow.run.list": async (params) => {
      const { workflowId, limit } = params as { workflowId: string; limit?: number }
      const all = await deps.snapshotService.list(workflowId)
      return limit ? all.slice(0, limit) : all
    },
    // Whole write
    "workflow.definition.create": async (params) => {
      const { name } = params as { name?: string }
      const result = await deps.workflowService.create()
      if ("errors" in result) return { errors: result.errors }
      if (name) {
        const def = await deps.workflowService.get(result.id)
        if (def) {
          def.name = name
          await deps.workflowService.save(def)
        }
      }
      emitDefinitionUpdated(result.id, result.versionHash)
      return result
    },
    "workflow.definition.update": async (params) => {
      const { definition } = params as { definition: WorkflowDefinition }
      const result = await deps.workflowService.save(definition) as WorkflowSaveResult | WorkflowSaveError
      if ("errors" in result) return { errors: result.errors }
      emitDefinitionUpdated(definition.id, result.versionHash)
      return result
    },
    "workflow.definition.delete": async (params) => {
      const { workflowId } = params as { workflowId: string }
      deps.cancelRun(workflowId)
      await deps.workflowService.delete(workflowId)
      await deps.snapshotService.deleteWorkflow(workflowId)
      emitDefinitionUpdated(workflowId, "deleted")
      return {}
    },
    // Execute
    "workflow.run.execute": async (params) => {
      const { workflowId, params: runParams } = params as { workflowId: string; params?: Record<string, unknown> }
      return deps.runWorkflow(workflowId, runParams ?? {})
    },
    "workflow.run.disable": (params) => {
      const { runId } = params as { runId: string }
      deps.cancelRun(runId)
      return {}
    },
    // Atomic
    "workflow.node.create": async (params) => {
      const { workflowId, node } = params as {
        workflowId: string
        node: { name: string; type: string; position?: { x: number; y: number }; config?: Record<string, unknown> }
      }
      return atomicMutate(workflowId, (def) => {
        const nodeId = randomUUID()
        const position = node.position ?? autoPosition(def.nodes)
        def.nodes.push({ id: nodeId, name: node.name, type: node.type, position, config: node.config ?? {} })
        return { result: { nodeId } }
      })
    },
    "workflow.node.update": async (params) => {
      const { workflowId, nodeId, patch } = params as {
        workflowId: string; nodeId: string
        patch: { name?: string; position?: { x: number; y: number }; config?: Record<string, unknown> }
      }
      return atomicMutate(workflowId, (def) => {
        const node = def.nodes.find((n) => n.id === nodeId)
        if (!node) throw new Error(`Node not found: ${nodeId}`)
        if (patch.name !== undefined) node.name = patch.name
        if (patch.position !== undefined) node.position = patch.position
        if (patch.config !== undefined) node.config = patch.config
        return {}
      })
    },
    "workflow.node.delete": async (params) => {
      const { workflowId, nodeId } = params as { workflowId: string; nodeId: string }
      return atomicMutate(workflowId, (def) => {
        const idx = def.nodes.findIndex((n) => n.id === nodeId)
        if (idx === -1) throw new Error(`Node not found: ${nodeId}`)
        def.nodes.splice(idx, 1)
        const before = def.edges.length
        def.edges = def.edges.filter((e) => e.from !== nodeId && e.to !== nodeId)
        return { result: { removedEdgeCount: before - def.edges.length } }
      })
    },
    "workflow.edge.create": async (params) => {
      const { workflowId, from, to, branch } = params as { workflowId: string; from: string; to: string; branch?: string }
      return atomicMutate(workflowId, (def) => {
        const edgeId = randomUUID()
        const edge: WorkflowDefinition["edges"][number] = { id: edgeId, from, to }
        if (branch) edge.branch = branch
        def.edges.push(edge)
        return { result: { edgeId } }
      })
    },
    "workflow.edge.delete": async (params) => {
      const { workflowId, edgeId } = params as { workflowId: string; edgeId: string }
      return atomicMutate(workflowId, (def) => {
        const idx = def.edges.findIndex((e) => e.id === edgeId)
        if (idx === -1) throw new Error(`Edge not found: ${edgeId}`)
        def.edges.splice(idx, 1)
        return {}
      })
    },
    "workflow.param.update": async (params) => {
      const { workflowId, params: newParams } = params as {
        workflowId: string; params: WorkflowDefinition["params"]
      }
      return atomicMutate(workflowId, (def) => {
        def.params = newParams
        return {}
      })
    },
  }

  return {
    async dispatch(action: string, params: Record<string, unknown>, _context: DispatchContext): Promise<DispatchResult> {
      const handler = handlers[action]
      if (!handler) throw new Error(`Unknown workflow action: ${action}`)
      const data = await handler(params)
      return typeof data === "object" && data !== null && "ok" in data ? (data as DispatchResult) : ok(data)
    },
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/workflow-dispatcher.test.ts 2>&1 | tail -30
```

Expected: all tests pass. Some tests may need minor adjustments due to `cardSummary` mock behavior — fix as needed.

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/capabilities/workflow-dispatcher.ts desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
git commit -m "feat(workflow-mcp): add workflow dispatcher with tests"
```

---

## Task 5: Action router integration

**Files:**
- Modify: `desktop/electron/capabilities/action-router.ts`
- Modify: `desktop/electron/capabilities/__tests__/action-router.test.ts`

- [ ] **Step 1: Add workflow dispatch to action router**

In `desktop/electron/capabilities/action-router.ts`, add `workflowDispatch` to the deps type and dispatch function:

```typescript
export type SynapseActionRouterDeps = {
  readonly databaseDispatch: DomainDispatch
  readonly schedulerDispatch: DomainDispatch
  readonly workflowDispatch: DomainDispatch
}
```

Add to the dispatch function body, before the `throw`:

```typescript
if (domainId === "workflow") return deps.workflowDispatch(action, params, context)
```

- [ ] **Step 2: Add test for workflow routing**

Add to `desktop/electron/capabilities/__tests__/action-router.test.ts`:

```typescript
  it("routes Workflow actions to the Workflow dispatcher", async () => {
    const databaseDispatch = vi.fn()
    const schedulerDispatch = vi.fn()
    const workflowDispatch = vi.fn(async () => ({ ok: true as const, data: [] }))
    const router = createSynapseActionRouter({
      databaseDispatch,
      schedulerDispatch,
      workflowDispatch,
    })

    await expect(router.dispatch("workflow.definition.list", {}, { source: "api" })).resolves.toEqual({
      ok: true,
      data: [],
    })
    expect(workflowDispatch).toHaveBeenCalledWith("workflow.definition.list", {}, { source: "api" })
    expect(databaseDispatch).not.toHaveBeenCalled()
    expect(schedulerDispatch).not.toHaveBeenCalled()
  })
```

Update existing tests that create the router to include the `workflowDispatch` field:

```typescript
workflowDispatch: vi.fn()
```

- [ ] **Step 3: Run tests**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add desktop/electron/capabilities/action-router.ts desktop/electron/capabilities/__tests__/action-router.test.ts
git commit -m "feat(workflow-mcp): wire workflow domain into action router"
```

---

## Task 6: Bootstrap wiring

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts:190-208` (the `coreDatabaseDescriptor`)

- [ ] **Step 1: Add imports**

Add to the import block in `descriptors.ts`:

```typescript
import { createWorkflowDispatcher } from "../capabilities/workflow-dispatcher"
import { nodeTypeRegistry } from "../../workflow-nodes/registry"
```

- [ ] **Step 2: Wire the dispatcher into coreDatabaseDescriptor**

In the `coreDatabaseDescriptor.create` method, the action router is currently created as:

```typescript
const actionRouter = createSynapseActionRouter({
  databaseDispatch: dispatchDatabaseAction,
  schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
})
```

Add workflow dispatch. The deps for the workflow dispatcher need to be resolved from the registry. Add before `createSynapseActionRouter`:

```typescript
const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
const snapshotService = ctx.registry.get<RunSnapshotService>("core.workflow.snapshots")
const runAborts = ctx.registry.get<Map<string, AbortController>>("core.workflow.run-aborts")
const runStatuses = ctx.registry.get<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
const workflowEngine = ctx.registry.get<WorkflowEngine>("core.workflow.engine")

const workflowDispatcher = createWorkflowDispatcher({
  workflowService,
  snapshotService,
  nodeTypeRegistry,
  eventBus,
  runWorkflow: async (id, params) => {
    const def = await workflowService.get(id)
    if (!def) return { errors: [{ type: "invalid_config" as const, message: "Workflow not found" }] }
    const validation = validateWorkflow(def)
    if (!validation.valid) return { errors: validation.errors }
    const runId = randomUUID()
    const ac = new AbortController()
    const startedAt = Date.now()
    runAborts.set(runId, ac)
    runStatuses.set(runId, { runId, workflowId: id, status: "running", nodeResults: {}, startedAt, params, definition: def })
    const appConfig = await configStore.load()
    const activeRepo = appConfig.repositories.find((r) => r.uuid === appConfig.activeRepoUuid) ?? appConfig.repositories[0]
    const projectId = activeRepo?.uuid
    workflowEngine.run(def, params, runId, (event) => {
      const current = runStatuses.get(runId) ?? { runId, workflowId: id, status: "running" as const, nodeResults: {}, startedAt }
      const nextNodeResults = { ...current.nodeResults }
      if (event.type === "node:started") {
        nextNodeResults[event.nodeId] = { ...(nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, input: { variables: {} } }), status: "running", startedAt: event.startedAt ?? Date.now() }
      } else if (event.type === "node:completed" || event.type === "node:failed" || event.type === "node:skipped") {
        nextNodeResults[event.nodeId] = event.result ?? nextNodeResults[event.nodeId] ?? { nodeId: event.nodeId, status: "failed", input: { variables: {} } }
      }
      runStatuses.set(runId, { ...current, nodeResults: nextNodeResults })
      eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() }, { backpressure: "block" })
      if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
        runAborts.delete(runId)
        const endedAt = Date.now()
        const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
        runStatuses.set(runId, { ...current, runId, workflowId: id, status, nodeResults: event.result?.nodeResults ?? nextNodeResults, startedAt, endedAt, durationMs: event.result?.durationMs ?? endedAt - startedAt, ...(event.type === "workflow:failed" ? { error: event.error } : {}) })
        void snapshotService.save({ runId, workflowId: id, version: def.version, startedAt, endedAt, status, params, nodeResults: event.result?.nodeResults ?? nextNodeResults, definition: def })
      }
    }, ac.signal, projectId).catch(() => { runAborts.delete(runId) })
    return { runId }
  },
  cancelRun: (runId) => { runAborts.get(runId)?.abort(); runAborts.delete(runId) },
  getRunStatus: async (runId) => runStatuses.get(runId) ?? null,
})
```

Then update the router creation:

```typescript
const actionRouter = createSynapseActionRouter({
  databaseDispatch: dispatchDatabaseAction,
  schedulerDispatch: (action, params) => dispatchSchedulerAction(taskScheduler, actionRuntime, action, params),
  workflowDispatch: (action, params, context) => workflowDispatcher.dispatch(action, params, context),
})
```

Also add `"core.workflow"`, `"core.workflow.snapshots"`, `"core.workflow.run-aborts"`, `"core.workflow.run-statuses"`, `"core.workflow.engine"` to the `dependsOn` array of `coreDatabaseDescriptor`.

**Note on duplication:** The `runWorkflow` closure duplicates engine-run + event-emit logic from `electron/modules/workflow/ipc.ts`. This is intentional for Phase 1 — the IPC path and MCP path are parallel entry points into the same engine. A future refactor could extract a shared `WorkflowRunCoordinator` service to eliminate this duplication, but it is out of scope for this task.

- [ ] **Step 3: Add needed imports if not already present**

Ensure these are imported at the top (most already are from existing code):

```typescript
import { validateWorkflow } from "../services/workflow/workflow-validator"
import { randomUUID } from "node:crypto"
```

(`randomUUID` may need to be added if not already imported.)

- [ ] **Step 4: Verify compilation**

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit -p tsconfig.electron.json 2>&1 | head -30
```

- [ ] **Step 5: Run existing tests to ensure no regressions**

```bash
pnpm --filter @synapse/desktop exec vitest run electron/capabilities/__tests__/action-router.test.ts electron/bootstrap/__tests__/registry.test.ts 2>&1 | tail -20
```

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(workflow-mcp): wire workflow dispatcher into bootstrap action router"
```

---

## Task 7: UI real-time update — editor listens for external changes

**Files:**
- Modify: `desktop/src/modules/workflow/editor/editor-app.tsx`

- [ ] **Step 1: Add EventBus listener for external definition updates**

In `editor-app.tsx`, add a `useEffect` that listens for `workflow:definition-updated` events from the preload API. The exact API depends on the existing event subscription pattern. Look for how `onEditorRefocus` is wired — it uses `window.synapse?.workflow.onEditorRefocus`. Add a similar listener for the EventBus event.

The EventBus broadcasts to renderer via `WindowBroadcaster` which uses `webContents.send`. The renderer side likely has a preload channel for receiving these events. Check `desktop/electron/modules/workflow/ipc.ts` events section for the channel name, then subscribe in the editor.

Add after the existing `useEffect` for `onEditorRefocus`:

```typescript
useEffect(() => {
  const unsub = window.synapse?.events?.on("workflow:definition-updated", (payload: { workflowId: string; source: string; versionHash: string }) => {
    if (payload.workflowId !== workflowId) return
    if (payload.source !== "mcp") return
    loadDefinition()
    toast.info("工作流已被外部更新", { duration: 2000 })
  })
  return unsub
}, [workflowId, loadDefinition])
```

**Note:** The exact preload event API (`window.synapse.events.on`) needs to be verified against the existing preload implementation. If the EventBus broadcast arrives via a different channel (e.g., a dedicated IPC event), wire accordingly. The implementation worker should check `desktop/electron/runtime/event-bus/broadcaster.ts` and the preload script to find the correct subscription API.

- [ ] **Step 2: Verify compilation**

```bash
pnpm --filter @synapse/desktop exec tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 3: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx
git commit -m "feat(workflow-mcp): editor reloads on external MCP definition updates"
```

---

## Task 8: Skill reference document

**Files:**
- Create: `desktop/docs/workflow-mcp-guide.md`

- [ ] **Step 1: Write the guide**

Create `desktop/docs/workflow-mcp-guide.md` with:

- Workflow system model (DAG, topological execution, parallel independence)
- Variable system (`{{variableName}}`, binding types: param / node_output / static)
- Graph constraints (one end node, no cycles, edge semantics)
- All three node types with config examples (prompt, switch, end)
- Two complete example workflow JSONs (linear chain, conditional branch)
- Recommended Agent workflow (discover → create → configure → validate → run → poll)
- Common mistakes and how to avoid them

This is a documentation-only task — content should be accurate against the current codebase.

- [ ] **Step 2: Commit**

```bash
git add desktop/docs/workflow-mcp-guide.md
git commit -m "docs: add workflow MCP guide for Agent skill injection"
```

---

## Task 9: End-to-end smoke test

This is a manual verification task.

- [ ] **Step 1: Run the full test suite**

```bash
pnpm --filter @synapse/desktop test 2>&1 | tail -30
```

All existing tests must still pass. New tests from Task 4 and Task 5 must pass.

- [ ] **Step 2: Verify MCP tool registration**

Write a quick check that all 18 tools are registered:

```bash
pnpm --filter @synapse/desktop exec node -e "
  require('../../workflow-nodes/register.main');
  const { buildAllMcpTools } = require('../../synapse-capabilities/shared/registry');
  const tools = buildAllMcpTools();
  const wfTools = tools.filter(t => t.name.startsWith('workflow_'));
  console.log('Workflow MCP tools:', wfTools.length);
  wfTools.forEach(t => console.log(' ', t.name));
  if (wfTools.length !== 18) { console.error('EXPECTED 18 TOOLS'); process.exit(1); }
"
```

**Note:** This command may need adjustment depending on module format (ESM vs CJS). If it doesn't work as a one-liner, create a temporary `verify-tools.ts` script, run with `tsx`, then delete it.

- [ ] **Step 3: Final commit if any fixes were needed**

```bash
git add -A
git commit -m "fix(workflow-mcp): address smoke test findings"
```
