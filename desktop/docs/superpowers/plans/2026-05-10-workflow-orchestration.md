# Workflow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a visual workflow orchestration feature to Synapse that lets users chain Prompt nodes on a DAG canvas, with Switch branching and variable-based data flow.

**Architecture:** Node type plugin system (self-contained folders) + DAG execution engine in Electron main process + React Flow canvas in independent editor windows. Edges = control flow only; data passes via variable references inside nodes.

**Tech Stack:** @xyflow/react, p-queue, Zod, Vitest, Electron BrowserWindow

---

## File Structure

```
desktop/
├── workflow-nodes/                    ← Node type plugins (cross-process)
│   ├── types.ts                       Shared interfaces (NodeManifest, NodeExecutor, etc.)
│   ├── registry.ts                    Node type registry
│   ├── prompt/
│   │   ├── manifest.ts                Prompt node metadata + ports
│   │   ├── schema.ts                  Zod config schema
│   │   ├── executor.main.ts           Main process execution (calls AgentRuntime)
│   │   ├── card.tsx                   Canvas card component
│   │   ├── panel.tsx                  Edit panel component
│   │   └── index.ts
│   └── switch/
│       ├── manifest.ts                Switch node metadata + dynamic ports
│       ├── schema.ts                  Zod config schema
│       ├── executor.main.ts           Main process execution (AI branch decision)
│       ├── card.tsx                   Canvas card component
│       ├── panel.tsx                  Edit panel component
│       └── index.ts
│
├── electron/
│   ├── ipc/workflow-handlers.ts       IPC handler (CRUD + run + window mgmt)
│   └── services/workflow/
│       ├── workflow-engine.ts          DAG execution engine
│       ├── workflow-service.ts         CRUD + Git full-snapshot storage
│       ├── variable-resolver.ts        Variable resolution logic
│       └── window-manager.ts           Editor window lifecycle
│
└── src/modules/workflow/               ← Renderer process
    ├── index.tsx                        Main window Tab (list view)
    ├── components/
    │   ├── workflow-list.tsx            Workflow list
    │   ├── workflow-card.tsx            List card item
    │   └── run-params-dialog.tsx        Pre-run parameter form
    ├── editor/
    │   ├── editor-app.tsx              Editor root (independent window)
    │   ├── canvas.tsx                  React Flow canvas wrapper
    │   ├── toolbar.tsx                 Top toolbar
    │   ├── node-palette.tsx            Left panel (drag to add)
    │   └── execution-overlay.tsx       Runtime state visualization
    └── hooks/
        ├── use-workflow-list.ts         List data hook
        ├── use-workflow-run.ts          Execution control hook
        └── use-workflow-events.ts       Real-time event listener hook
```

---

## Task 1: Shared Types & Node Plugin Interfaces

**Files:**
- Create: `workflow-nodes/types.ts`
- Create: `workflow-nodes/registry.ts`
- Test: `workflow-nodes/__tests__/registry.test.ts`

- [ ] **Step 1: Create shared type definitions**

```typescript
// workflow-nodes/types.ts
import type { z } from "zod"

// --- Data Model ---

export interface WorkflowDefinition {
  id: string
  name: string
  version: string
  params: WorkflowParam[]
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

export interface WorkflowParam {
  name: string
  type: "text" | "number"
  default: string | number | null
  description?: string
}

export interface WorkflowNode {
  id: string
  type: string
  position: { x: number; y: number }
  config: Record<string, unknown>
}

export interface WorkflowEdge {
  from: string
  to: string
  branch?: string
}

export interface VariableBinding {
  name: string
  source: VariableSource
}

export type VariableSource =
  | { type: "param"; param: string }
  | { type: "node_output"; node: string }
  | { type: "static"; value: string }

// --- Node Plugin Interfaces ---

export interface PortDefinition {
  id: string
  label: string
}

export interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: string
  color: string
  ports: {
    inputs: PortDefinition[]
    outputs: PortDefinition[] | "dynamic"
  }
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]
  cardSummary: (config: TConfig) => { title: string; subtitle: string }
  configSchema: z.ZodType<TConfig>
}

export interface NodeExecutionInput<TConfig = unknown> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
}

export interface NodeExecutionResult {
  status: "success" | "failed"
  output: string
  outputs?: Record<string, unknown>
  activeBranch?: string
  error?: string
  durationMs: number
}

export interface NodeExecutor<TConfig = unknown> {
  execute(input: NodeExecutionInput<TConfig>): Promise<NodeExecutionResult>
}

export interface WorkflowRuntimeContext {
  runId: string
  workflowId: string
  abortSignal: AbortSignal
  logger: { info(msg: string): void; error(msg: string, err?: unknown): void }
}

// --- Engine Events ---

export type WorkflowEvent =
  | { type: "workflow:started"; runId: string }
  | { type: "node:started"; nodeId: string }
  | { type: "node:completed"; nodeId: string; output: string }
  | { type: "node:failed"; nodeId: string; error: string }
  | { type: "edge:activated"; from: string; to: string }
  | { type: "workflow:completed"; result: WorkflowRunResult }
  | { type: "workflow:failed"; error: string }
  | { type: "workflow:cancelled" }

export interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
}

export interface NodeRunResult {
  status: "success" | "failed" | "skipped"
  output?: string
  error?: string
  durationMs: number
}

// --- Node Registration ---

export interface RegisteredNodeType<TConfig = unknown> {
  manifest: NodeManifest<TConfig>
  executor: NodeExecutor<TConfig>
}
```

- [ ] **Step 2: Create node type registry**

```typescript
// workflow-nodes/registry.ts
import type { RegisteredNodeType } from "./types"

export class WorkflowNodeRegistry {
  private readonly nodes = new Map<string, RegisteredNodeType>()

  register(node: RegisteredNodeType): void {
    const { type } = node.manifest
    if (this.nodes.has(type)) {
      throw new Error(`Workflow node type "${type}" is already registered`)
    }
    this.nodes.set(type, node)
  }

  get(type: string): RegisteredNodeType {
    const node = this.nodes.get(type)
    if (!node) {
      throw new Error(`Workflow node type "${type}" is not registered`)
    }
    return node
  }

  list(): readonly RegisteredNodeType[] {
    return [...this.nodes.values()]
  }

  has(type: string): boolean {
    return this.nodes.has(type)
  }
}
```

- [ ] **Step 3: Write registry tests**

```typescript
// workflow-nodes/__tests__/registry.test.ts
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { WorkflowNodeRegistry } from "../registry"
import type { RegisteredNodeType } from "../types"

const testSchema = z.object({ prompt: z.string() })

const testNode: RegisteredNodeType<z.infer<typeof testSchema>> = {
  manifest: {
    type: "test",
    title: "Test Node",
    icon: "circle",
    color: "blue",
    ports: {
      inputs: [{ id: "in", label: "Input" }],
      outputs: [{ id: "out", label: "Output" }],
    },
    cardSummary: (config) => ({ title: "Test", subtitle: config.prompt.slice(0, 20) }),
    configSchema: testSchema,
  },
  executor: {
    execute: async () => ({ status: "success", output: "ok", durationMs: 1 }),
  },
}

describe("WorkflowNodeRegistry", () => {
  it("registers and retrieves node types", () => {
    const registry = new WorkflowNodeRegistry()
    registry.register(testNode)

    expect(registry.get("test")).toBe(testNode)
    expect(registry.has("test")).toBe(true)
    expect(registry.list()).toHaveLength(1)
  })

  it("rejects duplicate type registration", () => {
    const registry = new WorkflowNodeRegistry()
    registry.register(testNode)

    expect(() => registry.register(testNode)).toThrow(/already registered/)
  })

  it("throws for unknown type", () => {
    const registry = new WorkflowNodeRegistry()

    expect(() => registry.get("missing")).toThrow(/not registered/)
    expect(registry.has("missing")).toBe(false)
  })
})
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run workflow-nodes/__tests__/registry.test.ts`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add workflow-nodes/
git commit -m "feat(workflow): add shared types and node registry"
```

---

## Task 2: Variable Resolver

**Files:**
- Create: `electron/services/workflow/variable-resolver.ts`
- Test: `electron/services/workflow/__tests__/variable-resolver.test.ts`

- [ ] **Step 1: Write variable resolver tests**

```typescript
// electron/services/workflow/__tests__/variable-resolver.test.ts
import { describe, expect, it } from "vitest"
import { resolveVariables } from "../variable-resolver"
import type { VariableBinding } from "../../../../workflow-nodes/types"

describe("resolveVariables", () => {
  const params = { repo_url: "https://github.com/test/repo", count: 5 }
  const nodeOutputs = {
    check_issue: "Issue #42 needs fixing: null pointer in auth module",
    generate_code: "function fix() { return true }",
  }

  it("resolves param source", () => {
    const variables: VariableBinding[] = [
      { name: "repo", source: { type: "param", param: "repo_url" } },
    ]
    const result = resolveVariables(variables, params, nodeOutputs)
    expect(result).toEqual({ repo: "https://github.com/test/repo" })
  })

  it("resolves node_output source", () => {
    const variables: VariableBinding[] = [
      { name: "analysis", source: { type: "node_output", node: "check_issue" } },
    ]
    const result = resolveVariables(variables, params, nodeOutputs)
    expect(result).toEqual({ analysis: "Issue #42 needs fixing: null pointer in auth module" })
  })

  it("resolves static source", () => {
    const variables: VariableBinding[] = [
      { name: "lang", source: { type: "static", value: "TypeScript" } },
    ]
    const result = resolveVariables(variables, params, nodeOutputs)
    expect(result).toEqual({ lang: "TypeScript" })
  })

  it("resolves multiple variables", () => {
    const variables: VariableBinding[] = [
      { name: "repo", source: { type: "param", param: "repo_url" } },
      { name: "code", source: { type: "node_output", node: "generate_code" } },
      { name: "hint", source: { type: "static", value: "be careful" } },
    ]
    const result = resolveVariables(variables, params, nodeOutputs)
    expect(result).toEqual({
      repo: "https://github.com/test/repo",
      code: "function fix() { return true }",
      hint: "be careful",
    })
  })

  it("converts number params to string", () => {
    const variables: VariableBinding[] = [
      { name: "n", source: { type: "param", param: "count" } },
    ]
    const result = resolveVariables(variables, params, nodeOutputs)
    expect(result).toEqual({ n: "5" })
  })

  it("throws when referencing missing param", () => {
    const variables: VariableBinding[] = [
      { name: "x", source: { type: "param", param: "nonexistent" } },
    ]
    expect(() => resolveVariables(variables, params, nodeOutputs))
      .toThrow(/param "nonexistent" not found/)
  })

  it("throws when referencing missing node output", () => {
    const variables: VariableBinding[] = [
      { name: "x", source: { type: "node_output", node: "missing_node" } },
    ]
    expect(() => resolveVariables(variables, params, nodeOutputs))
      .toThrow(/output of node "missing_node" not available/)
  })
})

describe("interpolatePrompt", () => {
  it("replaces {{$var}} placeholders with resolved values", () => {
    const { interpolatePrompt } = require("../variable-resolver")
    const resolved = { repo: "my-repo", issue: "42" }
    const template = "Check {{$repo}} issue #{{$issue}}"
    expect(interpolatePrompt(template, resolved)).toBe("Check my-repo issue #42")
  })

  it("throws on unresolved placeholder", () => {
    const { interpolatePrompt } = require("../variable-resolver")
    const resolved = { repo: "my-repo" }
    const template = "Check {{$repo}} and {{$missing}}"
    expect(() => interpolatePrompt(template, resolved)).toThrow(/variable "\$missing" not resolved/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run electron/services/workflow/__tests__/variable-resolver.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement variable resolver**

```typescript
// electron/services/workflow/variable-resolver.ts
import type { VariableBinding } from "../../../workflow-nodes/types"

export function resolveVariables(
  variables: VariableBinding[],
  params: Record<string, unknown>,
  nodeOutputs: Record<string, string>,
): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const binding of variables) {
    switch (binding.source.type) {
      case "param": {
        const value = params[binding.source.param]
        if (value === undefined) {
          throw new Error(`Variable resolution failed: param "${binding.source.param}" not found`)
        }
        resolved[binding.name] = String(value)
        break
      }
      case "node_output": {
        const output = nodeOutputs[binding.source.node]
        if (output === undefined) {
          throw new Error(
            `Variable resolution failed: output of node "${binding.source.node}" not available`,
          )
        }
        resolved[binding.name] = output
        break
      }
      case "static": {
        resolved[binding.name] = binding.source.value
        break
      }
    }
  }

  return resolved
}

export function interpolatePrompt(
  template: string,
  resolvedVariables: Record<string, string>,
): string {
  return template.replace(/\{\{\$(\w+)\}\}/g, (match, varName) => {
    const value = resolvedVariables[varName]
    if (value === undefined) {
      throw new Error(`Prompt interpolation failed: variable "$${varName}" not resolved`)
    }
    return value
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/workflow/__tests__/variable-resolver.test.ts`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/workflow/variable-resolver.ts electron/services/workflow/__tests__/variable-resolver.test.ts
git commit -m "feat(workflow): add variable resolver with interpolation"
```

---

## Task 3: Workflow Engine (DAG Scheduler)

**Files:**
- Create: `electron/services/workflow/workflow-engine.ts`
- Test: `electron/services/workflow/__tests__/workflow-engine.test.ts`

- [ ] **Step 1: Write engine tests**

```typescript
// electron/services/workflow/__tests__/workflow-engine.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { WorkflowEngine } from "../workflow-engine"
import { WorkflowNodeRegistry } from "../../../../workflow-nodes/registry"
import type {
  WorkflowDefinition,
  WorkflowEvent,
  RegisteredNodeType,
} from "../../../../workflow-nodes/types"
import { z } from "zod"

function createTestRegistry(): WorkflowNodeRegistry {
  const registry = new WorkflowNodeRegistry()
  const schema = z.object({ variables: z.array(z.any()).default([]), prompt: z.string() })

  const promptNode: RegisteredNodeType = {
    manifest: {
      type: "prompt",
      title: "Prompt",
      icon: "message-square",
      color: "blue",
      ports: { inputs: [{ id: "in", label: "In" }], outputs: [{ id: "out", label: "Out" }] },
      cardSummary: () => ({ title: "Prompt", subtitle: "" }),
      configSchema: schema,
    },
    executor: {
      execute: async ({ resolvedVariables }) => ({
        status: "success",
        output: `executed with: ${JSON.stringify(resolvedVariables)}`,
        durationMs: 10,
      }),
    },
  }

  const switchNode: RegisteredNodeType = {
    manifest: {
      type: "switch",
      title: "Switch",
      icon: "git-branch",
      color: "yellow",
      ports: { inputs: [{ id: "in", label: "In" }], outputs: "dynamic" },
      resolveDynamicPorts: (config: any) =>
        config.branches.map((b: string) => ({ id: b, label: b })),
      cardSummary: () => ({ title: "Switch", subtitle: "" }),
      configSchema: z.object({
        variables: z.array(z.any()).default([]),
        prompt: z.string(),
        branches: z.array(z.string()),
      }),
    },
    executor: {
      execute: async ({ config }) => ({
        status: "success",
        output: "fix",
        activeBranch: "fix",
        durationMs: 5,
      }),
    },
  }

  registry.register(promptNode)
  registry.register(switchNode)
  return registry
}

describe("WorkflowEngine", () => {
  let registry: WorkflowNodeRegistry
  let engine: WorkflowEngine

  beforeEach(() => {
    registry = createTestRegistry()
    engine = new WorkflowEngine(registry)
  })

  it("executes a linear chain in order", async () => {
    const definition: WorkflowDefinition = {
      id: "test-wf",
      name: "Test",
      version: "v_001",
      params: [],
      nodes: [
        { id: "a", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "step a" } },
        { id: "b", type: "prompt", position: { x: 0, y: 100 }, config: { variables: [], prompt: "step b" } },
      ],
      edges: [{ from: "a", to: "b" }],
    }

    const events: WorkflowEvent[] = []
    engine.on((e) => events.push(e))

    const result = await engine.run({
      definition,
      params: {},
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("completed")
    expect(result.nodeResults["a"].status).toBe("success")
    expect(result.nodeResults["b"].status).toBe("success")

    const nodeStartEvents = events.filter((e) => e.type === "node:started")
    expect(nodeStartEvents).toHaveLength(2)
  })

  it("routes switch branches correctly", async () => {
    const definition: WorkflowDefinition = {
      id: "test-switch",
      name: "Switch Test",
      version: "v_001",
      params: [],
      nodes: [
        { id: "sw", type: "switch", position: { x: 0, y: 0 }, config: { variables: [], prompt: "decide", branches: ["fix", "skip"] } },
        { id: "fix_node", type: "prompt", position: { x: 0, y: 100 }, config: { variables: [], prompt: "fixing" } },
        { id: "skip_node", type: "prompt", position: { x: 100, y: 100 }, config: { variables: [], prompt: "skipping" } },
      ],
      edges: [
        { from: "sw", to: "fix_node", branch: "fix" },
        { from: "sw", to: "skip_node", branch: "skip" },
      ],
    }

    const result = await engine.run({
      definition,
      params: {},
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("completed")
    expect(result.nodeResults["fix_node"].status).toBe("success")
    expect(result.nodeResults["skip_node"].status).toBe("skipped")
  })

  it("stops on node failure", async () => {
    const failRegistry = createTestRegistry()
    // Override prompt executor to fail
    const failNode: RegisteredNodeType = {
      manifest: failRegistry.get("prompt").manifest,
      executor: {
        execute: async () => ({ status: "failed", output: "", error: "boom", durationMs: 1 }),
      },
    }
    const failReg = new WorkflowNodeRegistry()
    failReg.register(failNode)
    failReg.register(failRegistry.get("switch"))
    const failEngine = new WorkflowEngine(failReg)

    const definition: WorkflowDefinition = {
      id: "fail-wf",
      name: "Fail",
      version: "v_001",
      params: [],
      nodes: [
        { id: "a", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "fail" } },
        { id: "b", type: "prompt", position: { x: 0, y: 100 }, config: { variables: [], prompt: "never" } },
      ],
      edges: [{ from: "a", to: "b" }],
    }

    const result = await failEngine.run({
      definition,
      params: {},
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("failed")
    expect(result.nodeResults["a"].status).toBe("failed")
    expect(result.nodeResults["b"]).toBeUndefined()
  })

  it("supports cancellation via abortSignal", async () => {
    const controller = new AbortController()
    // Create a slow executor
    const slowRegistry = new WorkflowNodeRegistry()
    slowRegistry.register({
      manifest: registry.get("prompt").manifest,
      executor: {
        execute: async ({ context }) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 5000)
            context.abortSignal.addEventListener("abort", () => {
              clearTimeout(timer)
              reject(new Error("aborted"))
            })
          })
          return { status: "success", output: "", durationMs: 0 }
        },
      },
    })
    slowRegistry.register(registry.get("switch"))
    const slowEngine = new WorkflowEngine(slowRegistry)

    const definition: WorkflowDefinition = {
      id: "cancel-wf",
      name: "Cancel",
      version: "v_001",
      params: [],
      nodes: [
        { id: "slow", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "slow" } },
      ],
      edges: [],
    }

    const promise = slowEngine.run({
      definition,
      params: {},
      abortSignal: controller.signal,
    })

    setTimeout(() => controller.abort(), 50)
    const result = await promise

    expect(result.status).toBe("cancelled")
  })

  it("detects cycles and rejects", async () => {
    const definition: WorkflowDefinition = {
      id: "cycle-wf",
      name: "Cycle",
      version: "v_001",
      params: [],
      nodes: [
        { id: "a", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "a" } },
        { id: "b", type: "prompt", position: { x: 0, y: 100 }, config: { variables: [], prompt: "b" } },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "a" }],
    }

    await expect(engine.run({
      definition,
      params: {},
      abortSignal: new AbortController().signal,
    })).rejects.toThrow(/cycle detected/)
  })

  it("executes parallel branches concurrently", async () => {
    const definition: WorkflowDefinition = {
      id: "parallel-wf",
      name: "Parallel",
      version: "v_001",
      params: [],
      nodes: [
        { id: "start", type: "prompt", position: { x: 0, y: 0 }, config: { variables: [], prompt: "start" } },
        { id: "branch_a", type: "prompt", position: { x: 0, y: 100 }, config: { variables: [], prompt: "a" } },
        { id: "branch_b", type: "prompt", position: { x: 100, y: 100 }, config: { variables: [], prompt: "b" } },
      ],
      edges: [
        { from: "start", to: "branch_a" },
        { from: "start", to: "branch_b" },
      ],
    }

    const result = await engine.run({
      definition,
      params: {},
      abortSignal: new AbortController().signal,
    })

    expect(result.status).toBe("completed")
    expect(result.nodeResults["branch_a"].status).toBe("success")
    expect(result.nodeResults["branch_b"].status).toBe("success")
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run electron/services/workflow/__tests__/workflow-engine.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement workflow engine**

```typescript
// electron/services/workflow/workflow-engine.ts
import PQueue from "p-queue"
import type {
  WorkflowDefinition,
  WorkflowEvent,
  WorkflowRunResult,
  NodeRunResult,
  WorkflowRuntimeContext,
  RegisteredNodeType,
} from "../../../workflow-nodes/types"
import type { WorkflowNodeRegistry } from "../../../workflow-nodes/registry"
import { resolveVariables, interpolatePrompt } from "./variable-resolver"

export interface WorkflowRunInput {
  definition: WorkflowDefinition
  params: Record<string, unknown>
  abortSignal: AbortSignal
}

export class WorkflowEngine {
  private readonly listeners: Array<(event: WorkflowEvent) => void> = []

  constructor(private readonly registry: WorkflowNodeRegistry) {}

  on(handler: (event: WorkflowEvent) => void): () => void {
    this.listeners.push(handler)
    return () => {
      const idx = this.listeners.indexOf(handler)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emit(event: WorkflowEvent): void {
    for (const listener of this.listeners) listener(event)
  }

  async run(input: WorkflowRunInput): Promise<WorkflowRunResult> {
    const { definition, params, abortSignal } = input
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const startTime = Date.now()

    // Validate DAG (detect cycles)
    this.validateDAG(definition)

    this.emit({ type: "workflow:started", runId })

    const nodeOutputs: Record<string, string> = {}
    const nodeResults: Record<string, NodeRunResult> = {}
    const completedNodes = new Set<string>()
    const skippedNodes = new Set<string>()
    let failed = false

    // Build adjacency: for each node, which nodes must complete before it
    const incomingEdges = new Map<string, Array<{ from: string; branch?: string }>>()
    const outgoingEdges = new Map<string, Array<{ to: string; branch?: string }>>()

    for (const node of definition.nodes) {
      incomingEdges.set(node.id, [])
      outgoingEdges.set(node.id, [])
    }
    for (const edge of definition.edges) {
      incomingEdges.get(edge.to)!.push({ from: edge.from, branch: edge.branch })
      outgoingEdges.get(edge.from)!.push({ to: edge.to, branch: edge.branch })
    }

    // Find start nodes (no incoming edges)
    const startNodes = definition.nodes
      .filter((n) => incomingEdges.get(n.id)!.length === 0)
      .map((n) => n.id)

    const queue = new PQueue({ concurrency: 3 })

    const isNodeReady = (nodeId: string): boolean => {
      const incoming = incomingEdges.get(nodeId)!
      return incoming.every(({ from }) => completedNodes.has(from) || skippedNodes.has(from))
    }

    const isNodeActivated = (nodeId: string): boolean => {
      const incoming = incomingEdges.get(nodeId)!
      if (incoming.length === 0) return true

      // A node is activated if at least one incoming edge is "active"
      return incoming.some(({ from, branch }) => {
        if (skippedNodes.has(from)) return false
        if (!completedNodes.has(from)) return false
        // If edge has a branch condition, check if the source node's activeBranch matches
        if (branch !== undefined) {
          const sourceResult = nodeResults[from]
          if (!sourceResult) return false
          // The source node must have selected this branch
          return (sourceResult as any).activeBranch === branch
        }
        return true
      })
    }

    const scheduleNode = (nodeId: string): void => {
      if (failed || abortSignal.aborted) return

      queue.add(async () => {
        if (failed || abortSignal.aborted) return

        const nodeDef = definition.nodes.find((n) => n.id === nodeId)!
        const nodeType = this.registry.get(nodeDef.type)

        this.emit({ type: "node:started", nodeId })
        const nodeStart = Date.now()

        try {
          // Resolve variables
          const variables = (nodeDef.config as any).variables ?? []
          const resolved = resolveVariables(variables, params, nodeOutputs)

          // Build context
          const context: WorkflowRuntimeContext = {
            runId,
            workflowId: definition.id,
            abortSignal,
            logger: {
              info: (msg) => {},
              error: (msg) => {},
            },
          }

          const result = await nodeType.executor.execute({
            config: nodeDef.config,
            resolvedVariables: resolved,
            context,
          })

          const duration = Date.now() - nodeStart

          if (result.status === "failed") {
            nodeResults[nodeId] = { status: "failed", error: result.error, durationMs: duration }
            failed = true
            this.emit({ type: "node:failed", nodeId, error: result.error ?? "Unknown error" })
            return
          }

          nodeOutputs[nodeId] = result.output
          nodeResults[nodeId] = {
            status: "success",
            output: result.output,
            durationMs: duration,
            ...(result.activeBranch ? { activeBranch: result.activeBranch } : {}),
          } as NodeRunResult & { activeBranch?: string }

          completedNodes.add(nodeId)
          this.emit({ type: "node:completed", nodeId, output: result.output })

          // Schedule downstream nodes
          const outgoing = outgoingEdges.get(nodeId) ?? []
          for (const { to, branch } of outgoing) {
            // If this is a branch edge, check if it's the active branch
            if (branch !== undefined && result.activeBranch !== branch) {
              // Mark the target and its descendants as skipped
              this.markSkipped(to, definition, outgoingEdges, skippedNodes, nodeResults)
              continue
            }

            this.emit({ type: "edge:activated", from: nodeId, to })

            if (isNodeReady(to) && isNodeActivated(to) && !skippedNodes.has(to)) {
              scheduleNode(to)
            }
          }
        } catch (err) {
          const duration = Date.now() - nodeStart
          const error = err instanceof Error ? err.message : String(err)
          nodeResults[nodeId] = { status: "failed", error, durationMs: duration }
          failed = true
          this.emit({ type: "node:failed", nodeId, error })
        }
      })
    }

    // Handle abort
    const abortHandler = () => {
      queue.clear()
    }
    abortSignal.addEventListener("abort", abortHandler)

    // Schedule start nodes
    for (const nodeId of startNodes) {
      scheduleNode(nodeId)
    }

    // Wait for all queued tasks
    await queue.onIdle()

    abortSignal.removeEventListener("abort", abortHandler)

    const totalDuration = Date.now() - startTime
    const status = abortSignal.aborted ? "cancelled" : failed ? "failed" : "completed"

    const result: WorkflowRunResult = {
      status,
      nodeResults,
      durationMs: totalDuration,
    }

    if (status === "completed") {
      this.emit({ type: "workflow:completed", result })
    } else if (status === "failed") {
      this.emit({ type: "workflow:failed", error: "One or more nodes failed" })
    } else {
      this.emit({ type: "workflow:cancelled" })
    }

    return result
  }

  private markSkipped(
    nodeId: string,
    definition: WorkflowDefinition,
    outgoingEdges: Map<string, Array<{ to: string; branch?: string }>>,
    skippedNodes: Set<string>,
    nodeResults: Record<string, NodeRunResult>,
  ): void {
    if (skippedNodes.has(nodeId)) return
    skippedNodes.add(nodeId)
    nodeResults[nodeId] = { status: "skipped", durationMs: 0 }

    const outgoing = outgoingEdges.get(nodeId) ?? []
    for (const { to } of outgoing) {
      this.markSkipped(to, definition, outgoingEdges, skippedNodes, nodeResults)
    }
  }

  private validateDAG(definition: WorkflowDefinition): void {
    const visited = new Set<string>()
    const inStack = new Set<string>()

    const adjacency = new Map<string, string[]>()
    for (const node of definition.nodes) {
      adjacency.set(node.id, [])
    }
    for (const edge of definition.edges) {
      adjacency.get(edge.from)!.push(edge.to)
    }

    const dfs = (nodeId: string): void => {
      visited.add(nodeId)
      inStack.add(nodeId)

      for (const neighbor of adjacency.get(nodeId) ?? []) {
        if (inStack.has(neighbor)) {
          throw new Error(`DAG validation failed: cycle detected involving node "${neighbor}"`)
        }
        if (!visited.has(neighbor)) {
          dfs(neighbor)
        }
      }

      inStack.delete(nodeId)
    }

    for (const node of definition.nodes) {
      if (!visited.has(node.id)) {
        dfs(node.id)
      }
    }
  }
}
```

- [ ] **Step 4: Install p-queue dependency**

Run: `pnpm add p-queue`

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/workflow/__tests__/workflow-engine.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 6: Commit**

```bash
git add electron/services/workflow/workflow-engine.ts electron/services/workflow/__tests__/workflow-engine.test.ts package.json pnpm-lock.yaml
git commit -m "feat(workflow): add DAG execution engine with branching and cancellation"
```

---

## Task 4: Prompt Node Plugin

**Files:**
- Create: `workflow-nodes/prompt/schema.ts`
- Create: `workflow-nodes/prompt/manifest.ts`
- Create: `workflow-nodes/prompt/executor.main.ts`
- Create: `workflow-nodes/prompt/card.tsx`
- Create: `workflow-nodes/prompt/panel.tsx`
- Create: `workflow-nodes/prompt/index.ts`
- Test: `workflow-nodes/prompt/__tests__/executor.test.ts`

- [ ] **Step 1: Create schema**

```typescript
// workflow-nodes/prompt/schema.ts
import { z } from "zod"

const variableBindingSchema = z.object({
  name: z.string().min(1),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("param"), param: z.string().min(1) }),
    z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
    z.object({ type: z.literal("static"), value: z.string() }),
  ]),
})

export const promptNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema).default([]),
  prompt: z.string().min(1),
})

export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
```

- [ ] **Step 2: Create manifest**

```typescript
// workflow-nodes/prompt/manifest.ts
import type { NodeManifest } from "../types"
import { promptNodeConfigSchema, type PromptNodeConfig } from "./schema"

export const promptNodeManifest: NodeManifest<PromptNodeConfig> = {
  type: "prompt",
  title: "Prompt",
  icon: "message-square",
  color: "blue",
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: [{ id: "out", label: "输出" }],
  },
  cardSummary: (config) => ({
    title: config.agent,
    subtitle: config.prompt.length > 40 ? config.prompt.slice(0, 40) + "..." : config.prompt,
  }),
  configSchema: promptNodeConfigSchema,
}
```

- [ ] **Step 3: Create executor with test**

```typescript
// workflow-nodes/prompt/__tests__/executor.test.ts
import { describe, expect, it, vi } from "vitest"
import { createPromptNodeExecutor } from "../executor.main"

describe("prompt node executor", () => {
  it("sends interpolated prompt to agent and returns response", async () => {
    const sendToAgent = vi.fn(async () => ({
      status: "success" as const,
      response: "The fix is: return null check",
      durationMs: 1200,
    }))

    const executor = createPromptNodeExecutor({ sendToAgent })

    const result = await executor.execute({
      config: {
        agent: "claude-code",
        variables: [{ name: "issue", source: { type: "static", value: "NPE in auth" } }],
        prompt: "Fix this: {{$issue}}",
      },
      resolvedVariables: { issue: "NPE in auth" },
      context: {
        runId: "run_1",
        workflowId: "wf_1",
        abortSignal: new AbortController().signal,
        logger: { info: () => {}, error: () => {} },
      },
    })

    expect(result.status).toBe("success")
    expect(result.output).toBe("The fix is: return null check")
    expect(sendToAgent).toHaveBeenCalledWith({
      agent: "claude-code",
      prompt: "Fix this: NPE in auth",
      abortSignal: expect.any(AbortSignal),
    })
  })

  it("returns failed status when agent errors", async () => {
    const sendToAgent = vi.fn(async () => ({
      status: "failed" as const,
      response: "",
      error: "Agent timeout",
      durationMs: 30000,
    }))

    const executor = createPromptNodeExecutor({ sendToAgent })

    const result = await executor.execute({
      config: { agent: "claude-code", variables: [], prompt: "hello" },
      resolvedVariables: {},
      context: {
        runId: "run_1",
        workflowId: "wf_1",
        abortSignal: new AbortController().signal,
        logger: { info: () => {}, error: () => {} },
      },
    })

    expect(result.status).toBe("failed")
    expect(result.error).toBe("Agent timeout")
  })
})
```

```typescript
// workflow-nodes/prompt/executor.main.ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import type { PromptNodeConfig } from "./schema"

export interface AgentSendResult {
  status: "success" | "failed"
  response: string
  error?: string
  durationMs: number
}

export interface PromptNodeDeps {
  sendToAgent: (input: {
    agent: string
    prompt: string
    abortSignal: AbortSignal
  }) => Promise<AgentSendResult>
}

export function createPromptNodeExecutor(deps: PromptNodeDeps): NodeExecutor<PromptNodeConfig> {
  return {
    async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
      const { config, resolvedVariables, context } = input
      const startTime = Date.now()

      const interpolatedPrompt = interpolatePrompt(config.prompt, resolvedVariables)

      const result = await deps.sendToAgent({
        agent: config.agent,
        prompt: interpolatedPrompt,
        abortSignal: context.abortSignal,
      })

      return {
        status: result.status,
        output: result.response,
        error: result.error,
        durationMs: Date.now() - startTime,
      }
    },
  }
}
```

- [ ] **Step 4: Create card and panel components (UI)**

```tsx
// workflow-nodes/prompt/card.tsx
import type { PromptNodeConfig } from "./schema"
import { promptNodeManifest } from "./manifest"

interface PromptNodeCardProps {
  config: PromptNodeConfig
  status?: "idle" | "running" | "completed" | "failed" | "skipped"
}

export function PromptNodeCard({ config, status }: PromptNodeCardProps) {
  const summary = promptNodeManifest.cardSummary(config)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>{summary.title}</span>
      </div>
      <div className="text-xs text-muted-foreground/70 line-clamp-2">
        {summary.subtitle}
      </div>
    </div>
  )
}
```

```tsx
// workflow-nodes/prompt/panel.tsx
import type { PromptNodeConfig } from "./schema"
import type { VariableBinding } from "../types"

interface PromptNodePanelProps {
  config: PromptNodeConfig
  onChange: (config: PromptNodeConfig) => void
  availableNodes: Array<{ id: string; name: string }>
  availableParams: Array<{ name: string }>
}

export function PromptNodePanel({ config, onChange, availableNodes, availableParams }: PromptNodePanelProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      {/* Agent selector */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Agent</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={config.agent}
          onChange={(e) => onChange({ ...config, agent: e.target.value })}
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      {/* Variables section */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">变量定义</label>
        {config.variables.map((v, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="font-mono">${v.name}</span>
            <span className="text-muted-foreground">=</span>
            <span className="text-muted-foreground">
              {v.source.type === "param" && `参数: ${v.source.param}`}
              {v.source.type === "node_output" && `节点: ${v.source.node}`}
              {v.source.type === "static" && `"${v.source.value}"`}
            </span>
          </div>
        ))}
        {/* Add variable button would go here */}
      </div>

      {/* Prompt editor */}
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Prompt</label>
        <textarea
          className="min-h-[120px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
          value={config.prompt}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          placeholder="使用 {{$变量名}} 引用变量..."
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create index**

```typescript
// workflow-nodes/prompt/index.ts
export { promptNodeManifest } from "./manifest"
export { promptNodeConfigSchema, type PromptNodeConfig } from "./schema"
export { createPromptNodeExecutor } from "./executor.main"
export { PromptNodeCard } from "./card"
export { PromptNodePanel } from "./panel"
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run workflow-nodes/prompt/__tests__/executor.test.ts`
Expected: 2 tests PASS

- [ ] **Step 7: Commit**

```bash
git add workflow-nodes/prompt/
git commit -m "feat(workflow): add prompt node plugin"
```

---

## Task 5: Switch Node Plugin

**Files:**
- Create: `workflow-nodes/switch/schema.ts`
- Create: `workflow-nodes/switch/manifest.ts`
- Create: `workflow-nodes/switch/executor.main.ts`
- Create: `workflow-nodes/switch/card.tsx`
- Create: `workflow-nodes/switch/panel.tsx`
- Create: `workflow-nodes/switch/index.ts`
- Test: `workflow-nodes/switch/__tests__/executor.test.ts`

- [ ] **Step 1: Create schema**

```typescript
// workflow-nodes/switch/schema.ts
import { z } from "zod"

const variableBindingSchema = z.object({
  name: z.string().min(1),
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("param"), param: z.string().min(1) }),
    z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
    z.object({ type: z.literal("static"), value: z.string() }),
  ]),
})

export const switchNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema).default([]),
  prompt: z.string().min(1),
  branches: z.array(z.string().min(1)).min(2),
})

export type SwitchNodeConfig = z.infer<typeof switchNodeConfigSchema>
```

- [ ] **Step 2: Create manifest with dynamic ports**

```typescript
// workflow-nodes/switch/manifest.ts
import type { NodeManifest } from "../types"
import { switchNodeConfigSchema, type SwitchNodeConfig } from "./schema"

export const switchNodeManifest: NodeManifest<SwitchNodeConfig> = {
  type: "switch",
  title: "Switch",
  icon: "git-branch",
  color: "yellow",
  ports: {
    inputs: [{ id: "in", label: "输入" }],
    outputs: "dynamic",
  },
  resolveDynamicPorts: (config) =>
    config.branches.map((branch) => ({ id: branch, label: branch })),
  cardSummary: (config) => ({
    title: "Switch",
    subtitle: config.branches.join(" / "),
  }),
  configSchema: switchNodeConfigSchema,
}
```

- [ ] **Step 3: Create executor with test**

```typescript
// workflow-nodes/switch/__tests__/executor.test.ts
import { describe, expect, it, vi } from "vitest"
import { createSwitchNodeExecutor } from "../executor.main"

describe("switch node executor", () => {
  it("returns activeBranch matching agent response", async () => {
    const sendToAgent = vi.fn(async () => ({
      status: "success" as const,
      response: "fix",
      durationMs: 800,
    }))

    const executor = createSwitchNodeExecutor({ sendToAgent })

    const result = await executor.execute({
      config: {
        agent: "claude-code",
        variables: [],
        prompt: "Decide: fix or skip?",
        branches: ["fix", "skip"],
      },
      resolvedVariables: {},
      context: {
        runId: "run_1",
        workflowId: "wf_1",
        abortSignal: new AbortController().signal,
        logger: { info: () => {}, error: () => {} },
      },
    })

    expect(result.status).toBe("success")
    expect(result.activeBranch).toBe("fix")
    expect(result.output).toBe("fix")
  })

  it("trims and lowercases agent response to match branch", async () => {
    const sendToAgent = vi.fn(async () => ({
      status: "success" as const,
      response: "  Skip  \n",
      durationMs: 500,
    }))

    const executor = createSwitchNodeExecutor({ sendToAgent })

    const result = await executor.execute({
      config: {
        agent: "claude-code",
        variables: [],
        prompt: "Decide",
        branches: ["fix", "skip"],
      },
      resolvedVariables: {},
      context: {
        runId: "run_1",
        workflowId: "wf_1",
        abortSignal: new AbortController().signal,
        logger: { info: () => {}, error: () => {} },
      },
    })

    expect(result.activeBranch).toBe("skip")
  })

  it("fails when agent response matches no branch", async () => {
    const sendToAgent = vi.fn(async () => ({
      status: "success" as const,
      response: "maybe",
      durationMs: 500,
    }))

    const executor = createSwitchNodeExecutor({ sendToAgent })

    const result = await executor.execute({
      config: {
        agent: "claude-code",
        variables: [],
        prompt: "Decide",
        branches: ["fix", "skip"],
      },
      resolvedVariables: {},
      context: {
        runId: "run_1",
        workflowId: "wf_1",
        abortSignal: new AbortController().signal,
        logger: { info: () => {}, error: () => {} },
      },
    })

    expect(result.status).toBe("failed")
    expect(result.error).toContain("no matching branch")
  })
})
```

```typescript
// workflow-nodes/switch/executor.main.ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import type { SwitchNodeConfig } from "./schema"
import type { PromptNodeDeps } from "../prompt/executor.main"

export function createSwitchNodeExecutor(deps: PromptNodeDeps): NodeExecutor<SwitchNodeConfig> {
  return {
    async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
      const { config, resolvedVariables, context } = input
      const startTime = Date.now()

      const interpolatedPrompt = interpolatePrompt(config.prompt, resolvedVariables)

      const result = await deps.sendToAgent({
        agent: config.agent,
        prompt: interpolatedPrompt,
        abortSignal: context.abortSignal,
      })

      if (result.status === "failed") {
        return {
          status: "failed",
          output: "",
          error: result.error,
          durationMs: Date.now() - startTime,
        }
      }

      // Match response to a branch (case-insensitive, trimmed)
      const response = result.response.trim().toLowerCase()
      const matchedBranch = config.branches.find(
        (b) => b.toLowerCase() === response,
      )

      if (!matchedBranch) {
        return {
          status: "failed",
          output: result.response,
          error: `Switch decision failed: agent responded "${result.response}" but no matching branch found. Expected one of: ${config.branches.join(", ")}`,
          durationMs: Date.now() - startTime,
        }
      }

      return {
        status: "success",
        output: matchedBranch,
        activeBranch: matchedBranch,
        durationMs: Date.now() - startTime,
      }
    },
  }
}
```

- [ ] **Step 4: Create card and panel components**

```tsx
// workflow-nodes/switch/card.tsx
import type { SwitchNodeConfig } from "./schema"

interface SwitchNodeCardProps {
  config: SwitchNodeConfig
  status?: "idle" | "running" | "completed" | "failed" | "skipped"
}

export function SwitchNodeCard({ config }: SwitchNodeCardProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span>Switch</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {config.branches.map((branch) => (
          <span
            key={branch}
            className="rounded px-1.5 py-0.5 text-[10px] bg-muted text-muted-foreground"
          >
            {branch}
          </span>
        ))}
      </div>
    </div>
  )
}
```

```tsx
// workflow-nodes/switch/panel.tsx
import type { SwitchNodeConfig } from "./schema"

interface SwitchNodePanelProps {
  config: SwitchNodeConfig
  onChange: (config: SwitchNodeConfig) => void
  availableNodes: Array<{ id: string; name: string }>
  availableParams: Array<{ name: string }>
}

export function SwitchNodePanel({ config, onChange, availableNodes, availableParams }: SwitchNodePanelProps) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">Agent</label>
        <select
          className="h-9 rounded-md border bg-background px-3 text-sm"
          value={config.agent}
          onChange={(e) => onChange({ ...config, agent: e.target.value })}
        >
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">判断 Prompt</label>
        <textarea
          className="min-h-[100px] rounded-md border bg-background px-3 py-2 text-sm font-mono"
          value={config.prompt}
          onChange={(e) => onChange({ ...config, prompt: e.target.value })}
          placeholder="让 Agent 判断走哪个分支，输出分支名..."
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium">分支</label>
        <div className="flex flex-wrap gap-2">
          {config.branches.map((branch, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                className="h-7 w-24 rounded border bg-background px-2 text-sm"
                value={branch}
                onChange={(e) => {
                  const newBranches = [...config.branches]
                  newBranches[i] = e.target.value
                  onChange({ ...config, branches: newBranches })
                }}
              />
              {config.branches.length > 2 && (
                <button
                  className="text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => onChange({ ...config, branches: config.branches.filter((_, j) => j !== i) })}
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            className="h-7 rounded border border-dashed px-2 text-xs text-muted-foreground"
            onClick={() => onChange({ ...config, branches: [...config.branches, `branch_${config.branches.length + 1}`] })}
          >
            + 添加分支
          </button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create index**

```typescript
// workflow-nodes/switch/index.ts
export { switchNodeManifest } from "./manifest"
export { switchNodeConfigSchema, type SwitchNodeConfig } from "./schema"
export { createSwitchNodeExecutor } from "./executor.main"
export { SwitchNodeCard } from "./card"
export { SwitchNodePanel } from "./panel"
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run workflow-nodes/switch/__tests__/executor.test.ts`
Expected: 3 tests PASS

- [ ] **Step 7: Commit**

```bash
git add workflow-nodes/switch/
git commit -m "feat(workflow): add switch node plugin with AI branch routing"
```

---

## Task 6: Workflow Storage Service

**Files:**
- Create: `electron/services/workflow/workflow-service.ts`
- Test: `electron/services/workflow/__tests__/workflow-service.test.ts`

- [ ] **Step 1: Write storage service tests**

```typescript
// electron/services/workflow/__tests__/workflow-service.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest"
import { WorkflowService } from "../workflow-service"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { tmpdir } from "node:os"

describe("WorkflowService", () => {
  let service: WorkflowService
  let testDir: string

  beforeEach(async () => {
    testDir = path.join(tmpdir(), `wf-test-${Date.now()}`)
    await fs.mkdir(testDir, { recursive: true })
    service = new WorkflowService(testDir)
  })

  afterEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true })
  })

  it("saves a workflow and lists it", async () => {
    const definition = {
      id: "test-wf",
      name: "Test Workflow",
      version: "",
      params: [],
      nodes: [{ id: "a", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "hi" } }],
      edges: [],
    }

    const { versionHash } = await service.save(definition)
    expect(versionHash).toMatch(/^v_\d+_[a-z0-9]+$/)

    const list = await service.list()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe("test-wf")
    expect(list[0].name).toBe("Test Workflow")
  })

  it("get returns the latest version", async () => {
    const def1 = {
      id: "wf-1",
      name: "V1",
      version: "",
      params: [],
      nodes: [],
      edges: [],
    }
    await service.save(def1)

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 10))

    const def2 = { ...def1, name: "V2" }
    await service.save(def2)

    const latest = await service.get("wf-1")
    expect(latest.name).toBe("V2")
  })

  it("delete removes the workflow directory", async () => {
    const def = { id: "to-delete", name: "Delete Me", version: "", params: [], nodes: [], edges: [] }
    await service.save(def)

    await service.delete("to-delete")
    const list = await service.list()
    expect(list).toHaveLength(0)
  })

  it("get throws for nonexistent workflow", async () => {
    await expect(service.get("nope")).rejects.toThrow(/not found/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run electron/services/workflow/__tests__/workflow-service.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement workflow service**

```typescript
// electron/services/workflow/workflow-service.ts
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { createHash } from "node:crypto"
import type { WorkflowDefinition } from "../../../workflow-nodes/types"

export interface WorkflowMeta {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export class WorkflowService {
  constructor(private readonly baseDir: string) {}

  async save(definition: WorkflowDefinition): Promise<{ versionHash: string }> {
    const workflowDir = path.join(this.baseDir, definition.id)
    await fs.mkdir(workflowDir, { recursive: true })

    // Write/update meta.json
    const metaPath = path.join(workflowDir, "meta.json")
    const now = new Date().toISOString()
    let meta: Record<string, unknown>
    try {
      meta = JSON.parse(await fs.readFile(metaPath, "utf-8"))
      meta.name = definition.name
      meta.updatedAt = now
    } catch {
      meta = {
        id: definition.id,
        name: definition.name,
        createdAt: now,
        updatedAt: now,
      }
    }
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2))

    // Generate version filename: v_<timestamp>_<short-hash>.json
    const timestamp = Date.now()
    const content = JSON.stringify(definition)
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 8)
    const versionHash = `v_${timestamp}_${hash}`
    const versionFile = path.join(workflowDir, `${versionHash}.json`)

    // Write version with the hash embedded
    const versionedDef = { ...definition, version: versionHash }
    await fs.writeFile(versionFile, JSON.stringify(versionedDef, null, 2))

    return { versionHash }
  }

  async list(): Promise<WorkflowMeta[]> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.baseDir)
    } catch {
      return []
    }

    const results: WorkflowMeta[] = []
    for (const entry of entries) {
      const metaPath = path.join(this.baseDir, entry, "meta.json")
      try {
        const raw = await fs.readFile(metaPath, "utf-8")
        const meta = JSON.parse(raw)
        const versions = await this.listVersionFiles(entry)
        const latestVersion = versions.length > 0
          ? JSON.parse(await fs.readFile(path.join(this.baseDir, entry, versions[versions.length - 1]), "utf-8"))
          : null
        results.push({
          id: meta.id,
          name: meta.name,
          nodeCount: latestVersion?.nodes?.length ?? 0,
          createdAt: meta.createdAt,
          updatedAt: meta.updatedAt,
        })
      } catch {
        // Skip invalid entries
      }
    }

    return results
  }

  async get(id: string): Promise<WorkflowDefinition> {
    const versions = await this.listVersionFiles(id)
    if (versions.length === 0) {
      throw new Error(`Workflow "${id}" not found`)
    }

    const latestFile = path.join(this.baseDir, id, versions[versions.length - 1])
    const raw = await fs.readFile(latestFile, "utf-8")
    return JSON.parse(raw)
  }

  async delete(id: string): Promise<void> {
    const dir = path.join(this.baseDir, id)
    await fs.rm(dir, { recursive: true, force: true })
  }

  private async listVersionFiles(id: string): Promise<string[]> {
    const dir = path.join(this.baseDir, id)
    let files: string[]
    try {
      files = await fs.readdir(dir)
    } catch {
      throw new Error(`Workflow "${id}" not found`)
    }
    return files
      .filter((f) => f.startsWith("v_") && f.endsWith(".json"))
      .sort() // Lexicographic sort works because timestamp prefix
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run electron/services/workflow/__tests__/workflow-service.test.ts`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add electron/services/workflow/workflow-service.ts electron/services/workflow/__tests__/workflow-service.test.ts
git commit -m "feat(workflow): add workflow storage service with Git full-snapshot versioning"
```

---

## Task 7: Window Manager

**Files:**
- Create: `electron/services/workflow/window-manager.ts`
- Test: `electron/services/workflow/__tests__/window-manager.test.ts`

- [ ] **Step 1: Write window manager tests**

```typescript
// electron/services/workflow/__tests__/window-manager.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { WorkflowWindowManager } from "../window-manager"

// Mock BrowserWindow
const mockWindow = (id: string) => ({
  id,
  isDestroyed: vi.fn(() => false),
  focus: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  webContents: { send: vi.fn() },
})

describe("WorkflowWindowManager", () => {
  let manager: WorkflowWindowManager
  let createWindow: ReturnType<typeof vi.fn>

  beforeEach(() => {
    createWindow = vi.fn((workflowId: string) => mockWindow(workflowId))
    manager = new WorkflowWindowManager(createWindow)
  })

  it("opens a new editor window", () => {
    manager.openEditor("wf-1")
    expect(createWindow).toHaveBeenCalledWith("wf-1")
    expect(manager.getOpenEditors()).toEqual(["wf-1"])
  })

  it("focuses existing window instead of creating duplicate", () => {
    manager.openEditor("wf-1")
    manager.openEditor("wf-1")
    expect(createWindow).toHaveBeenCalledTimes(1)
  })

  it("allows multiple different workflows open simultaneously", () => {
    manager.openEditor("wf-1")
    manager.openEditor("wf-2")
    expect(manager.getOpenEditors()).toEqual(["wf-1", "wf-2"])
  })

  it("checkCanSync returns false when editors are open", () => {
    manager.openEditor("wf-1")
    const result = manager.checkCanSync()
    expect(result.canSync).toBe(false)
    expect(result.blockers).toContain("wf-1")
  })

  it("checkCanSync returns true when no editors are open", () => {
    const result = manager.checkCanSync()
    expect(result.canSync).toBe(true)
    expect(result.blockers).toHaveLength(0)
  })

  it("removes window from tracking when closed", () => {
    manager.openEditor("wf-1")
    manager.handleWindowClosed("wf-1")
    expect(manager.getOpenEditors()).toEqual([])
    expect(manager.checkCanSync().canSync).toBe(true)
  })
})
```

- [ ] **Step 2: Implement window manager**

```typescript
// electron/services/workflow/window-manager.ts
type WindowLike = {
  isDestroyed(): boolean
  focus(): void
  close(): void
  on(event: string, handler: () => void): void
  webContents: { send(channel: string, ...args: unknown[]): void }
}

type CreateWindowFn = (workflowId: string) => WindowLike

export class WorkflowWindowManager {
  private readonly windows = new Map<string, WindowLike>()

  constructor(private readonly createWindow: CreateWindowFn) {}

  openEditor(workflowId: string): void {
    const existing = this.windows.get(workflowId)
    if (existing && !existing.isDestroyed()) {
      existing.focus()
      return
    }

    const window = this.createWindow(workflowId)
    this.windows.set(workflowId, window)
  }

  handleWindowClosed(workflowId: string): void {
    this.windows.delete(workflowId)
  }

  getOpenEditors(): string[] {
    // Clean up destroyed windows
    for (const [id, win] of this.windows) {
      if (win.isDestroyed()) this.windows.delete(id)
    }
    return [...this.windows.keys()]
  }

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const editors = this.getOpenEditors()
    return {
      canSync: editors.length === 0,
      blockers: editors,
    }
  }

  sendEvent(workflowId: string, event: unknown): void {
    const win = this.windows.get(workflowId)
    if (win && !win.isDestroyed()) {
      win.webContents.send("synapse:workflow:event", event)
    }
  }

  closeAll(): string[] {
    const openIds = this.getOpenEditors()
    for (const [, win] of this.windows) {
      if (!win.isDestroyed()) win.close()
    }
    return openIds
  }
}
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run electron/services/workflow/__tests__/window-manager.test.ts`
Expected: All 6 tests PASS

- [ ] **Step 4: Commit**

```bash
git add electron/services/workflow/window-manager.ts electron/services/workflow/__tests__/window-manager.test.ts
git commit -m "feat(workflow): add editor window manager with sync guard"
```

---

## Task 8: IPC Handlers

**Files:**
- Create: `electron/ipc/workflow-handlers.ts`
- Test: `tests/ipc/workflow-handlers.test.ts`

- [ ] **Step 1: Create IPC handlers**

```typescript
// electron/ipc/workflow-handlers.ts
import type { WorkflowService } from "../services/workflow/workflow-service"
import type { WorkflowEngine, WorkflowRunInput } from "../services/workflow/workflow-engine"
import type { WorkflowWindowManager } from "../services/workflow/window-manager"
import type { WorkflowDefinition } from "../../workflow-nodes/types"

export interface WorkflowHandlerDeps {
  workflowService: WorkflowService
  workflowEngine: WorkflowEngine
  windowManager: WorkflowWindowManager
}

export function registerWorkflowHandlers(
  ipcMain: { handle(channel: string, handler: (...args: any[]) => any): void },
  deps: WorkflowHandlerDeps,
) {
  const { workflowService, workflowEngine, windowManager } = deps

  // CRUD
  ipcMain.handle("synapse:workflow:list", async () => {
    return workflowService.list()
  })

  ipcMain.handle("synapse:workflow:get", async (_event, { id }: { id: string }) => {
    return workflowService.get(id)
  })

  ipcMain.handle("synapse:workflow:save", async (_event, { definition }: { definition: WorkflowDefinition }) => {
    return workflowService.save(definition)
  })

  ipcMain.handle("synapse:workflow:delete", async (_event, { id }: { id: string }) => {
    return workflowService.delete(id)
  })

  // Execution
  const activeRuns = new Map<string, AbortController>()

  ipcMain.handle("synapse:workflow:run", async (_event, { id, params }: { id: string; params: Record<string, unknown> }) => {
    const definition = await workflowService.get(id)
    const controller = new AbortController()
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    activeRuns.set(runId, controller)

    // Run async — don't await, return runId immediately
    workflowEngine.run({
      definition,
      params,
      abortSignal: controller.signal,
    }).finally(() => {
      activeRuns.delete(runId)
    })

    return { runId }
  })

  ipcMain.handle("synapse:workflow:cancel", async (_event, { runId }: { runId: string }) => {
    const controller = activeRuns.get(runId)
    if (controller) controller.abort()
  })

  // Window management
  ipcMain.handle("synapse:workflow:open-editor", async (_event, { id }: { id: string }) => {
    windowManager.openEditor(id)
  })

  ipcMain.handle("synapse:workflow:editor-state", async () => {
    return { openEditors: windowManager.getOpenEditors() }
  })

  ipcMain.handle("synapse:workflow:check-can-sync", async () => {
    return windowManager.checkCanSync()
  })
}
```

- [ ] **Step 2: Write IPC handler test**

```typescript
// tests/ipc/workflow-handlers.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest"
import { registerWorkflowHandlers } from "../../electron/ipc/workflow-handlers"

describe("workflow IPC handlers", () => {
  let handlers: Record<string, Function>
  let mockService: any
  let mockEngine: any
  let mockWindowManager: any

  beforeEach(() => {
    handlers = {}
    const ipcMain = {
      handle: (channel: string, handler: Function) => { handlers[channel] = handler },
    }

    mockService = {
      list: vi.fn(async () => [{ id: "wf-1", name: "Test", nodeCount: 2, createdAt: "", updatedAt: "" }]),
      get: vi.fn(async () => ({ id: "wf-1", name: "Test", version: "v_1", params: [], nodes: [], edges: [] })),
      save: vi.fn(async () => ({ versionHash: "v_123_abc" })),
      delete: vi.fn(async () => {}),
    }

    mockEngine = {
      run: vi.fn(async () => ({ status: "completed", nodeResults: {}, durationMs: 100 })),
      on: vi.fn(),
    }

    mockWindowManager = {
      openEditor: vi.fn(),
      getOpenEditors: vi.fn(() => ["wf-1"]),
      checkCanSync: vi.fn(() => ({ canSync: false, blockers: ["wf-1"] })),
    }

    registerWorkflowHandlers(ipcMain, {
      workflowService: mockService,
      workflowEngine: mockEngine,
      windowManager: mockWindowManager,
    })
  })

  it("registers all expected channels", () => {
    expect(Object.keys(handlers)).toEqual(expect.arrayContaining([
      "synapse:workflow:list",
      "synapse:workflow:get",
      "synapse:workflow:save",
      "synapse:workflow:delete",
      "synapse:workflow:run",
      "synapse:workflow:cancel",
      "synapse:workflow:open-editor",
      "synapse:workflow:editor-state",
      "synapse:workflow:check-can-sync",
    ]))
  })

  it("list delegates to service", async () => {
    const result = await handlers["synapse:workflow:list"]({})
    expect(result).toHaveLength(1)
    expect(mockService.list).toHaveBeenCalled()
  })

  it("check-can-sync returns window manager state", async () => {
    const result = await handlers["synapse:workflow:check-can-sync"]({})
    expect(result.canSync).toBe(false)
    expect(result.blockers).toContain("wf-1")
  })
})
```

- [ ] **Step 3: Run tests**

Run: `pnpm vitest run tests/ipc/workflow-handlers.test.ts`
Expected: 3 tests PASS

- [ ] **Step 4: Commit**

```bash
git add electron/ipc/workflow-handlers.ts tests/ipc/workflow-handlers.test.ts
git commit -m "feat(workflow): add IPC handlers for CRUD, execution, and window management"
```

---

## Task 9: Renderer — Workflow List (Main Window Tab)

**Files:**
- Create: `src/modules/workflow/index.tsx`
- Create: `src/modules/workflow/components/workflow-list.tsx`
- Create: `src/modules/workflow/components/workflow-card.tsx`
- Create: `src/modules/workflow/components/run-params-dialog.tsx`
- Create: `src/modules/workflow/hooks/use-workflow-list.ts`
- Create: `src/modules/workflow/hooks/use-workflow-run.ts`

- [ ] **Step 1: Create workflow list hook**

```typescript
// src/modules/workflow/hooks/use-workflow-list.ts
import { useCallback, useEffect, useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"

export interface WorkflowMeta {
  id: string
  name: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export function useWorkflowList() {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const bridge = requireSynapseBridge()
      const list = await bridge.workflow.list()
      setWorkflows(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  return { workflows, loading, refresh }
}
```

- [ ] **Step 2: Create workflow run hook**

```typescript
// src/modules/workflow/hooks/use-workflow-run.ts
import { useCallback, useState } from "react"
import { toast } from "sonner"
import { requireSynapseBridge } from "@/lib/electron-bridge"

export function useWorkflowRun() {
  const [runningId, setRunningId] = useState<string | null>(null)

  const run = useCallback(async (id: string, params: Record<string, unknown>) => {
    setRunningId(id)
    try {
      const bridge = requireSynapseBridge()
      const { runId } = await bridge.workflow.run({ id, params })
      toast("工作流已启动")
      return runId
    } catch (err) {
      toast.error("启动工作流失败")
      return null
    } finally {
      setRunningId(null)
    }
  }, [])

  const cancel = useCallback(async (runId: string) => {
    const bridge = requireSynapseBridge()
    await bridge.workflow.cancel({ runId })
    toast("已取消")
  }, [])

  return { run, cancel, runningId }
}
```

- [ ] **Step 3: Create workflow card component**

```tsx
// src/modules/workflow/components/workflow-card.tsx
import type { WorkflowMeta } from "../hooks/use-workflow-list"

interface WorkflowCardProps {
  workflow: WorkflowMeta
  isEditing: boolean
  onOpen: () => void
  onRun: () => void
  onDelete: () => void
}

export function WorkflowCard({ workflow, isEditing, onOpen, onRun, onDelete }: WorkflowCardProps) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors hover:bg-accent/50 ${isEditing ? "border-yellow-300 bg-yellow-50 dark:bg-yellow-950/20" : ""}`}
      onDoubleClick={onOpen}
    >
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{workflow.name}</div>
        <div className="text-xs text-muted-foreground">
          {workflow.nodeCount} 个节点
          {isEditing && <span className="ml-2 text-yellow-600">编辑中</span>}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          className="h-7 px-2 rounded text-xs hover:bg-accent"
          onClick={(e) => { e.stopPropagation(); onRun() }}
        >
          ▶
        </button>
        <button
          className="h-7 px-2 rounded text-xs hover:bg-accent"
          onClick={(e) => { e.stopPropagation(); onOpen() }}
        >
          编辑
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create run params dialog**

```tsx
// src/modules/workflow/components/run-params-dialog.tsx
import { useState } from "react"
import type { WorkflowParam } from "../../../../workflow-nodes/types"

interface RunParamsDialogProps {
  params: WorkflowParam[]
  onConfirm: (values: Record<string, unknown>) => void
  onCancel: () => void
}

export function RunParamsDialog({ params, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const p of params) {
      initial[p.name] = p.default ?? ""
    }
    return initial
  })

  return (
    <div className="flex flex-col gap-4 p-4">
      <h3 className="text-sm font-medium">运行参数</h3>
      {params.map((param) => (
        <div key={param.name} className="flex flex-col gap-1">
          <label className="text-xs font-medium">{param.name}</label>
          {param.description && (
            <span className="text-xs text-muted-foreground">{param.description}</span>
          )}
          <input
            className="h-8 rounded-md border bg-background px-2 text-sm"
            type={param.type === "number" ? "number" : "text"}
            value={String(values[param.name] ?? "")}
            onChange={(e) => setValues({
              ...values,
              [param.name]: param.type === "number" ? Number(e.target.value) : e.target.value,
            })}
          />
        </div>
      ))}
      <div className="flex justify-end gap-2">
        <button className="h-8 px-3 rounded-md border text-sm" onClick={onCancel}>取消</button>
        <button className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm" onClick={() => onConfirm(values)}>运行</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create workflow list page**

```tsx
// src/modules/workflow/components/workflow-list.tsx
import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { useWorkflowList } from "../hooks/use-workflow-list"
import { useWorkflowRun } from "../hooks/use-workflow-run"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"

export function WorkflowList() {
  const { workflows, loading, refresh } = useWorkflowList()
  const { run } = useWorkflowRun()
  const [openEditors, setOpenEditors] = useState<string[]>([])
  const [runTarget, setRunTarget] = useState<string | null>(null)

  const handleOpen = async (id: string) => {
    const bridge = requireSynapseBridge()
    await bridge.workflow.openEditor({ id })
    const state = await bridge.workflow.editorState()
    setOpenEditors(state.openEditors)
  }

  const handleRun = (id: string) => {
    setRunTarget(id)
  }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (runTarget) {
      await run(runTarget, params)
      setRunTarget(null)
    }
  }

  if (loading) {
    return <div className="p-4 text-sm text-muted-foreground">加载中...</div>
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium">工作流</h2>
        {/* Create button would go here */}
      </div>

      {workflows.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          暂无工作流
        </div>
      ) : (
        workflows.map((wf) => (
          <WorkflowCard
            key={wf.id}
            workflow={wf}
            isEditing={openEditors.includes(wf.id)}
            onOpen={() => handleOpen(wf.id)}
            onRun={() => handleRun(wf.id)}
            onDelete={() => {}}
          />
        ))
      )}

      {runTarget && (
        <RunParamsDialog
          params={[]} // Would load from workflow definition
          onConfirm={handleConfirmRun}
          onCancel={() => setRunTarget(null)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 6: Create module index**

```tsx
// src/modules/workflow/index.tsx
import { WorkflowList } from "./components/workflow-list"

export function WorkflowModule() {
  return <WorkflowList />
}
```

- [ ] **Step 7: Commit**

```bash
git add src/modules/workflow/
git commit -m "feat(workflow): add workflow list module for main window tab"
```

---

## Task 10: Renderer — Editor Window (Canvas + Toolbar + Palette)

**Files:**
- Create: `src/modules/workflow/editor/editor-app.tsx`
- Create: `src/modules/workflow/editor/canvas.tsx`
- Create: `src/modules/workflow/editor/toolbar.tsx`
- Create: `src/modules/workflow/editor/node-palette.tsx`
- Create: `src/modules/workflow/hooks/use-workflow-events.ts`

- [ ] **Step 1: Install @xyflow/react**

```bash
pnpm add @xyflow/react
```

- [ ] **Step 2: Create the workflow events hook**

```typescript
// src/modules/workflow/hooks/use-workflow-events.ts
import { useEffect, useRef, useCallback } from "react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { WorkflowEvent } from "../../../../workflow-nodes/types"

type WorkflowEventHandler = (event: WorkflowEvent) => void

export function useWorkflowEvents(runId: string | null, handler: WorkflowEventHandler) {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!runId) return undefined
    const bridge = getSynapseBridge()
    if (!bridge) return undefined

    return bridge.workflow.onEvent((event: WorkflowEvent) => {
      handlerRef.current(event)
    })
  }, [runId])
}
```

- [ ] **Step 3: Create the canvas component**

```tsx
// src/modules/workflow/editor/canvas.tsx
import { useCallback } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  addEdge,
  type Connection,
  type Node,
  type Edge,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import type { WorkflowDefinition } from "../../../../workflow-nodes/types"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"

const nodeTypes = {
  prompt: PromptNodeCard,
  switch: SwitchNodeCard,
}

type WorkflowCanvasProps = {
  definition: WorkflowDefinition
  onDefinitionChange: (def: WorkflowDefinition) => void
  onNodeSelect: (nodeId: string | null) => void
}

function definitionToFlowNodes(def: WorkflowDefinition): Node[] {
  return def.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: { config: node.config },
  }))
}

function definitionToFlowEdges(def: WorkflowDefinition): Edge[] {
  return def.edges.map((edge, i) => ({
    id: `e-${edge.from}-${edge.to}-${i}`,
    source: edge.from,
    target: edge.to,
    label: edge.branch ?? undefined,
    animated: false,
  }))
}

export function WorkflowCanvas({ definition, onDefinitionChange, onNodeSelect }: WorkflowCanvasProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState(definitionToFlowNodes(definition))
  const [edges, setEdges, onEdgesChange] = useEdgesState(definitionToFlowEdges(definition))

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => addEdge(connection, eds))
    onDefinitionChange({
      ...definition,
      edges: [
        ...definition.edges,
        { from: connection.source!, to: connection.target! },
      ],
    })
  }, [definition, onDefinitionChange, setEdges])

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    onNodeSelect(node.id)
  }, [onNodeSelect])

  const onPaneClick = useCallback(() => {
    onNodeSelect(null)
  }, [onNodeSelect])

  return (
    <div className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
```

- [ ] **Step 4: Create the toolbar component**

```tsx
// src/modules/workflow/editor/toolbar.tsx
import { Play, Save, Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

type ToolbarProps = {
  name: string
  onNameChange: (name: string) => void
  onSave: () => void
  onRun: () => void
  onCancel: () => void
  isRunning: boolean
  isDirty: boolean
}

export function WorkflowToolbar({
  name,
  onNameChange,
  onSave,
  onRun,
  onCancel,
  isRunning,
  isDirty,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-2 border-b px-4 py-2">
      <Input
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        className="w-64"
      />

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={onSave} disabled={!isDirty}>
          <Save className="mr-1 h-4 w-4" />
          保存
        </Button>

        {isRunning ? (
          <Button variant="destructive" size="sm" onClick={onCancel}>
            <Square className="mr-1 h-4 w-4" />
            停止
          </Button>
        ) : (
          <Button size="sm" onClick={onRun}>
            <Play className="mr-1 h-4 w-4" />
            运行
          </Button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Create the node palette component**

```tsx
// src/modules/workflow/editor/node-palette.tsx
import { GripVertical, MessageSquare, GitBranch } from "lucide-react"

type PaletteItem = {
  type: string
  label: string
  icon: React.ReactNode
}

const PALETTE_ITEMS: PaletteItem[] = [
  { type: "prompt", label: "Prompt", icon: <MessageSquare className="h-4 w-4" /> },
  { type: "switch", label: "Switch", icon: <GitBranch className="h-4 w-4" /> },
]

export function NodePalette() {
  const onDragStart = (event: React.DragEvent, nodeType: string) => {
    event.dataTransfer.setData("application/reactflow", nodeType)
    event.dataTransfer.effectAllowed = "move"
  }

  return (
    <div className="w-48 border-r p-3">
      <p className="mb-2 text-xs font-medium text-muted-foreground">节点</p>
      <div className="flex flex-col gap-1">
        {PALETTE_ITEMS.map((item) => (
          <div
            key={item.type}
            className="flex cursor-grab items-center gap-2 rounded-md border px-2 py-1.5 text-sm hover:bg-muted"
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
          >
            <GripVertical className="h-3 w-3 text-muted-foreground" />
            {item.icon}
            {item.label}
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Create the editor app root component**

```tsx
// src/modules/workflow/editor/editor-app.tsx
import { useState, useEffect, useCallback } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { getSynapseBridge } from "@/lib/electron-bridge"
import type { WorkflowDefinition } from "../../../../workflow-nodes/types"
import { WorkflowCanvas } from "./canvas"
import { WorkflowToolbar } from "./toolbar"
import { NodePalette } from "./node-palette"
import { ExecutionOverlay } from "./execution-overlay"
import { useWorkflowEvents } from "../hooks/use-workflow-events"

export function WorkflowEditorApp() {
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const [isDirty, setIsDirty] = useState(false)
  const [runId, setRunId] = useState<string | null>(null)
  const [nodeStates, setNodeStates] = useState<Record<string, string>>({})
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const workflowId = params.get("workflowId")
    if (!workflowId) return

    const bridge = getSynapseBridge()
    if (!bridge) return

    bridge.workflow.get(workflowId).then(setDefinition)
  }, [])

  useWorkflowEvents(runId, (event) => {
    if (event.type === "node:started") {
      setNodeStates((prev) => ({ ...prev, [event.nodeId]: "running" }))
    } else if (event.type === "node:completed") {
      setNodeStates((prev) => ({ ...prev, [event.nodeId]: "completed" }))
    } else if (event.type === "node:failed") {
      setNodeStates((prev) => ({ ...prev, [event.nodeId]: "failed" }))
    } else if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
      setRunId(null)
    }
  })

  const handleSave = useCallback(async () => {
    if (!definition) return
    const bridge = getSynapseBridge()
    if (!bridge) return
    await bridge.workflow.save(definition)
    setIsDirty(false)
  }, [definition])

  const handleRun = useCallback(async () => {
    if (!definition) return
    await handleSave()
    const bridge = getSynapseBridge()
    if (!bridge) return
    const result = await bridge.workflow.run(definition.id, {})
    setRunId(result.runId)
    setNodeStates({})
  }, [definition, handleSave])

  const handleCancel = useCallback(async () => {
    if (!runId) return
    const bridge = getSynapseBridge()
    if (!bridge) return
    await bridge.workflow.cancel(runId)
    setRunId(null)
  }, [runId])

  const handleDefinitionChange = useCallback((def: WorkflowDefinition) => {
    setDefinition(def)
    setIsDirty(true)
  }, [])

  if (!definition) {
    return <div className="flex h-screen items-center justify-center text-muted-foreground">加载中...</div>
  }

  return (
    <ReactFlowProvider>
      <div className="flex h-screen flex-col">
        <WorkflowToolbar
          name={definition.name}
          onNameChange={(name) => handleDefinitionChange({ ...definition, name })}
          onSave={handleSave}
          onRun={handleRun}
          onCancel={handleCancel}
          isRunning={!!runId}
          isDirty={isDirty}
        />
        <div className="flex flex-1 overflow-hidden">
          <NodePalette />
          <div className="relative flex-1">
            <WorkflowCanvas
              definition={definition}
              onDefinitionChange={handleDefinitionChange}
              onNodeSelect={setSelectedNodeId}
            />
            {runId && <ExecutionOverlay nodeStates={nodeStates} />}
          </div>
        </div>
      </div>
    </ReactFlowProvider>
  )
}
```

- [ ] **Step 7: Verify build compiles**

Run: `pnpm --filter desktop exec tsc --noEmit`
Expected: No type errors related to workflow editor files.

- [ ] **Step 8: Commit**

```bash
git add src/modules/workflow/editor/ src/modules/workflow/hooks/use-workflow-events.ts
git commit -m "feat(workflow): add editor window with React Flow canvas, toolbar, and node palette"
```

---

## Task 11: Execution Overlay & Runtime Visualization

**Files:**
- Create: `src/modules/workflow/editor/execution-overlay.tsx`

- [ ] **Step 1: Create the execution overlay component**

```tsx
// src/modules/workflow/editor/execution-overlay.tsx
import { CheckCircle2, XCircle, Loader2, MinusCircle } from "lucide-react"
import { cn } from "@/lib/utils"

type NodeState = "idle" | "running" | "completed" | "failed" | "skipped"

type ExecutionOverlayProps = {
  nodeStates: Record<string, string>
}

function NodeStatusIcon({ status }: { status: NodeState }) {
  switch (status) {
    case "running":
      return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
    case "completed":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />
    case "failed":
      return <XCircle className="h-4 w-4 text-destructive" />
    case "skipped":
      return <MinusCircle className="h-4 w-4 text-muted-foreground" />
    default:
      return null
  }
}

export function ExecutionOverlay({ nodeStates }: ExecutionOverlayProps) {
  const entries = Object.entries(nodeStates)
  if (entries.length === 0) return null

  const running = entries.filter(([, s]) => s === "running").length
  const completed = entries.filter(([, s]) => s === "completed").length
  const failed = entries.filter(([, s]) => s === "failed").length

  return (
    <div className="absolute bottom-4 right-4 z-10 rounded-lg border bg-card p-3 shadow-sm">
      <p className="mb-1 text-xs font-medium text-muted-foreground">执行状态</p>
      <div className="flex items-center gap-3 text-sm">
        {running > 0 && (
          <span className="flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
            {running} 执行中
          </span>
        )}
        {completed > 0 && (
          <span className="flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3 text-green-500" />
            {completed} 完成
          </span>
        )}
        {failed > 0 && (
          <span className="flex items-center gap-1">
            <XCircle className="h-3 w-3 text-destructive" />
            {failed} 失败
          </span>
        )}
      </div>
    </div>
  )
}

export { NodeStatusIcon }
export type { NodeState }
```

- [ ] **Step 2: Add node status styling to canvas card components**

The Prompt and Switch card components need to accept a `status` prop and render visual state. Update the card components created in Tasks 5 and 6.

```tsx
// workflow-nodes/prompt/card.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { MessageSquare } from "lucide-react"
import { cn } from "../../src/lib/utils"
import type { PromptNodeConfig } from "./schema"

type PromptCardData = {
  config: PromptNodeConfig
  status?: "idle" | "running" | "completed" | "failed" | "skipped"
}

export function PromptNodeCard({ data }: NodeProps) {
  const { config, status } = data as PromptCardData
  const prompt = config?.prompt ?? ""
  const truncated = prompt.length > 60 ? prompt.slice(0, 60) + "..." : prompt

  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border bg-card px-3 py-2 shadow-sm",
        status === "running" && "border-blue-500 ring-2 ring-blue-500/20",
        status === "completed" && "border-green-500",
        status === "failed" && "border-destructive",
        status === "skipped" && "opacity-50",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Prompt</span>
      </div>
      {truncated && (
        <p className="mt-1 text-xs text-muted-foreground">{truncated}</p>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}
```

```tsx
// workflow-nodes/switch/card.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { GitBranch } from "lucide-react"
import { cn } from "../../src/lib/utils"
import type { SwitchNodeConfig } from "./schema"

type SwitchCardData = {
  config: SwitchNodeConfig
  status?: "idle" | "running" | "completed" | "failed" | "skipped"
}

export function SwitchNodeCard({ data }: NodeProps) {
  const { config, status } = data as SwitchCardData
  const branches = config?.branches ?? []

  return (
    <div
      className={cn(
        "min-w-[180px] rounded-lg border bg-card px-3 py-2 shadow-sm",
        status === "running" && "border-blue-500 ring-2 ring-blue-500/20",
        status === "completed" && "border-green-500",
        status === "failed" && "border-destructive",
        status === "skipped" && "opacity-50",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <GitBranch className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Switch</span>
      </div>
      {branches.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {branches.join(" / ")}
        </p>
      )}
      {branches.map((branch, i) => (
        <Handle
          key={branch}
          type="source"
          position={Position.Bottom}
          id={branch}
          style={{ left: `${((i + 1) / (branches.length + 1)) * 100}%` }}
        />
      ))}
      {branches.length === 0 && <Handle type="source" position={Position.Bottom} />}
    </div>
  )
}
```

- [ ] **Step 3: Wire node states into canvas during execution**

Update `editor-app.tsx` to pass `nodeStates` into the canvas nodes' data:

```tsx
// In editor-app.tsx, update the definition passed to WorkflowCanvas
// Add this effect after the useWorkflowEvents hook:

useEffect(() => {
  if (!definition) return
  // When nodeStates change during a run, update node data with status
  setDefinition((prev) => {
    if (!prev) return prev
    return {
      ...prev,
      nodes: prev.nodes.map((node) => ({
        ...node,
        config: { ...node.config, __status: nodeStates[node.id] ?? "idle" },
      })),
    }
  })
}, [nodeStates])
```

And in `canvas.tsx`, update `definitionToFlowNodes` to pass status:

```typescript
function definitionToFlowNodes(def: WorkflowDefinition): Node[] {
  return def.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      config: node.config,
      status: (node.config as Record<string, unknown>).__status ?? "idle",
    },
  }))
}
```

- [ ] **Step 4: Verify build compiles**

Run: `pnpm --filter desktop exec tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workflow/editor/execution-overlay.tsx workflow-nodes/prompt/card.tsx workflow-nodes/switch/card.tsx
git commit -m "feat(workflow): add execution overlay and runtime node status visualization"
```

---

## Task 12: Integration — Navigation + Content Type + Sync Guard

**Files:**
- Modify: `src/types/content.ts`
- Create: `src/types/workflow.ts`
- Modify: `src/types/bridge.ts`
- Create: `src/config/content-types/workflow.ts`
- Modify: `src/config/content-types/index.ts`
- Modify: `electron/preload.ts`
- Modify: App shell tab configuration (navigation)

- [ ] **Step 1: Add "workflow" to SynapseContentType**

```typescript
// src/types/content.ts — modify the type union
export type SynapseContentType = "rule" | "skill" | "prompt" | "workflow"
```

- [ ] **Step 2: Create workflow content type definition**

```typescript
// src/config/content-types/workflow.ts
import type { ContentTypeDefinition } from "./types"

export const workflowContentTypeDefinition: ContentTypeDefinition = {
  id: "workflow",
  singularLabel: "工作流",
  pluralLabel: "工作流",
  tabLabel: "工作流",
  emptyStateNoun: "工作流",
  capabilities: {
    hasAttachments: false,
    canInstallToEditor: false,
    canCopyContent: false,
    canDownload: true,
    canRunAsAgent: false,
  },
  download: {
    extension: "json",
    dialogFilterName: "Workflow JSON",
    exporter: "text-file",
  },
  install: { kind: "none" },
  repositoryDir: {
    defaultDirectoryName: "workflows",
  },
  categories: [],
  requiresFilesInPayload: false,
}
```

- [ ] **Step 3: Register workflow content type in the registry**

```typescript
// src/config/content-types/index.ts — add import and registry entry
import { workflowContentTypeDefinition } from "./workflow"

export const CONTENT_TYPE_REGISTRY = {
  rule: ruleContentTypeDefinition,
  skill: skillContentTypeDefinition,
  prompt: promptContentTypeDefinition,
  workflow: workflowContentTypeDefinition,
} as const satisfies Record<SynapseContentType, ContentTypeDefinition>
```

- [ ] **Step 4: Add workflow bridge type definitions**

```typescript
// src/types/workflow.ts
import type { WorkflowDefinition, WorkflowEvent } from "../../workflow-nodes/types"

export type WorkflowMeta = {
  id: string
  name: string
  description?: string
  nodeCount: number
  createdAt: string
  updatedAt: string
}

export type WorkflowRunResult = {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, { status: string; output?: string; error?: string }>
  durationMs: number
}

export type WorkflowBridge = {
  list(): Promise<WorkflowMeta[]>
  get(id: string): Promise<WorkflowDefinition>
  save(definition: WorkflowDefinition): Promise<{ versionHash: string }>
  delete(id: string): Promise<void>
  run(id: string, params: Record<string, unknown>): Promise<{ runId: string }>
  cancel(runId: string): Promise<void>
  runStatus(runId: string): Promise<WorkflowRunResult>
  openEditor(id: string): Promise<void>
  editorState(): Promise<{ openEditors: string[] }>
  checkCanSync(): Promise<{ canSync: boolean; blockers: string[] }>
  onEvent(handler: (event: WorkflowEvent) => void): () => void
}
```

- [ ] **Step 5: Add workflow domain to SynapseBridge**

```typescript
// src/types/bridge.ts — add import and property
import type { WorkflowBridge } from "./workflow"

// Add to SynapseBridge interface:
workflow: WorkflowBridge
```

- [ ] **Step 6: Add workflow tab to navigation**

The app shell uses a tab system. Add the workflow tab to the tab list. Locate the tab definitions (likely in the component that renders the main window tabs) and add:

```typescript
// In the tab configuration array (e.g., where "rule", "skill", "prompt" tabs are defined)
// Add after the existing tabs:
{
  id: "workflow",
  label: "工作流",
  icon: GitBranch, // from lucide-react
}
```

And in the tab content renderer, add the case:

```tsx
// Where tab content is rendered based on active tab:
case "workflow":
  return <WorkflowModule />
```

Import at the top:

```typescript
import { WorkflowModule } from "@/modules/workflow"
import { GitBranch } from "lucide-react"
```

- [ ] **Step 7: Add sync guard integration**

In the repository sync flow (where `syncRepository` is called), add a pre-check:

The `WorkflowWindowManager` class already has a `checkCanSync()` method (defined in Task 8). The IPC handler (Task 9) already calls `windowManager.checkCanSync()` for the `synapse:workflow:check-can-sync` channel.

In the repository sync flow, call the workflow check-can-sync IPC before proceeding:

```typescript
// In the renderer-side sync trigger (e.g., use-repository-manager.ts or equivalent):
const bridge = getSynapseBridge()
const { canSync, blockers } = await bridge.workflow.checkCanSync()
if (!canSync) {
  // Show toast: "请先关闭编辑中的工作流"
  return
}
// Proceed with sync...
```

In the IPC handler for sync (or wherever sync is triggered), add the check before proceeding:

```typescript
// In the sync handler, before calling syncRepository:
const workflowCheck = checkWorkflowSyncBlockers()
if (!workflowCheck.canSync) {
  return { error: workflowCheck.blockers.join("; ") }
}
```

- [ ] **Step 8: Register workflow IPC channels in preload**

```typescript
// electron/preload.ts — add workflow domain to the exposed bridge
// In the contextBridge.exposeInMainWorld("synapse", { ... }) call:
workflow: {
  list: () => ipcRenderer.invoke("synapse:workflow:list"),
  get: (id: string) => ipcRenderer.invoke("synapse:workflow:get", id),
  save: (def: unknown) => ipcRenderer.invoke("synapse:workflow:save", def),
  delete: (id: string) => ipcRenderer.invoke("synapse:workflow:delete", id),
  run: (id: string, params: unknown) => ipcRenderer.invoke("synapse:workflow:run", { id, params }),
  cancel: (runId: string) => ipcRenderer.invoke("synapse:workflow:cancel", runId),
  runStatus: (runId: string) => ipcRenderer.invoke("synapse:workflow:run-status", runId),
  openEditor: (id: string) => ipcRenderer.invoke("synapse:workflow:open-editor", id),
  editorState: () => ipcRenderer.invoke("synapse:workflow:editor-state"),
  checkCanSync: () => ipcRenderer.invoke("synapse:workflow:check-can-sync"),
  onEvent: (handler: (event: unknown) => void) => {
    const listener = (_: unknown, event: unknown) => handler(event)
    ipcRenderer.on("synapse:workflow:event", listener)
    return () => { ipcRenderer.removeListener("synapse:workflow:event", listener) }
  },
},
```

- [ ] **Step 9: Verify full build**

Run: `pnpm --filter desktop exec tsc --noEmit`
Expected: No type errors across the entire project.

- [ ] **Step 10: Commit**

```bash
git add src/types/content.ts src/types/workflow.ts src/types/bridge.ts \
  src/config/content-types/workflow.ts src/config/content-types/index.ts \
  electron/preload.ts
git commit -m "feat(workflow): integrate workflow as content type with navigation, bridge, and sync guard"
```
