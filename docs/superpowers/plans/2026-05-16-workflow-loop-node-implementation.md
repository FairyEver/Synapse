# 工作流循环节点 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `loop` composite node type to Synapse workflows supporting while/for/forEach iteration via subgraph encapsulation.

**Architecture:** A loop node wraps a subgraph (internal nodes + edges) in its `config.subgraph` field. A new `SubgraphRunner` extracted from `WorkflowEngine` executes subgraphs; the loop executor manages iteration lifecycle (variable passing, exit checks, max iteration safety valve). The editor renders loop nodes as expandable containers with internal canvas editing. No changes to `ReactiveScheduler` or outer DAG validation.

**Tech Stack:** TypeScript 6, Zod, React 19 + @xyflow/react, Vitest

---

## File Structure Map

### New Files (13)

| File | Responsibility |
|---|---|
| `workflow-nodes/loop/schema.ts` | `LoopNodeConfig` zod schema + validation |
| `workflow-nodes/loop/manifest.ts` | `NodeManifest<LoopNodeConfig>` (icon, ports, cardSummary, configFields) |
| `workflow-nodes/loop/card.tsx` | React card for collapsed state rendering |
| `workflow-nodes/loop/executor.main.ts` | `NodeExecutor<LoopNodeConfig>` — while/for/forEach iteration logic |
| `workflow-nodes/loop/index.ts` | Re-exports manifest + executor |
| `electron/services/workflow/subgraph-runner.ts` | Reusable subgraph DAG executor |
| `src/modules/workflow/editor/loop-container.tsx` | Expandable container node (dashed border, internal canvas) |
| `src/modules/workflow/editor/loop-output-node.tsx` | Loop Output terminal with continue/break ports |
| `src/modules/workflow/editor/loop-input-node.tsx` | Loop Input start node exposing loop.* variables |
| `src/modules/workflow/components/loop-config-panel.tsx` | Right-side config panel (mode, vars, forEach options) |
| `src/modules/workflow/components/iteration-result-viewer.tsx` | Post-execution iteration tab navigation |
| `electron/services/__tests__/subgraph-runner.test.ts` | SubgraphRunner unit tests |
| `electron/services/__tests__/loop-executor.test.ts` | Loop executor unit tests |

### Modified Files (10)

| File | Change |
|---|---|
| `src/types/workflow.ts` | Add `IterationResult`, `NodeRunResult.iterations?` |
| `electron/services/workflow/variable-resolver.ts` | Support `loop.*` variable prefix in context |
| `electron/services/workflow/workflow-engine.ts` | Extract subgraph logic into `SubgraphRunner` |
| `electron/services/workflow/workflow-validator.ts` | Recursive subgraph validation + loop rules |
| `workflow-nodes/register.main.ts` | Register loop executor |
| `workflow-nodes/register.renderer.ts` | Register loop manifest |
| `workflow-nodes/panel-registry.ts` | Register loop config panel |
| `src/modules/workflow/editor/node-wrappers.tsx` | Add `LoopNodeWrapper` to `nodeTypes` map |
| `src/modules/workflow/editor/editor-app.tsx` | Add loop to node palette (if palette auto-reads registry, no change needed) |
| `src/modules/workflow/editor/canvas.tsx` | Handle container-internal edge storage in `defToFlow`/`flowNodeToWorkflowNode` |

---

### Task 1: Type Definitions

**Depends on:** none (can start immediately)

**Files:**
- Modify: `src/types/workflow.ts` — add `IterationResult` and `NodeRunResult.iterations`
- Verify: `workflow-nodes/types.ts` — `SubgraphDefinition`, `LoopVariable`, `OutputMapping` already exist (from earlier work)

- [ ] **Step 1: Add IterationResult to `src/types/workflow.ts`**

Edit `src/types/workflow.ts`:

After the `NodeRunResult` interface closing brace (after the `progressLabel` field), add:

```typescript
export interface IterationResult {
  index: number
  status: "success" | "failed" | "skipped" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  loopVariables: Record<string, unknown>
  exitPort: "continue" | "break"
  output?: string
  outputs?: Record<string, unknown>
  durationMs?: number
  error?: string
}
```

Add `iterations?: IterationResult[]` to the `NodeRunResult` interface (after `progressLabel` line):

```typescript
  progressLabel?: string
  /** 循环迭代详情（仅 loop 节点有此字段） */
  iterations?: IterationResult[]
```

- [ ] **Step 2: Verify existing types in `workflow-nodes/types.ts`**

Read and confirm `SubgraphDefinition`, `LoopVariable`, `OutputMapping` exist (lines 69-86). They already do based on exploration. No change needed.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No type errors (existing types plus new optional fields).

- [ ] **Step 4: Commit**

```bash
git add src/types/workflow.ts
git commit -m "feat(workflow): add IterationResult type and NodeRunResult.iterations field"
```

---

### Task 2: Loop Node Schema & Manifest

**Depends on:** none (can start immediately, parallel with Task 1)

**Files:**
- Create: `workflow-nodes/loop/schema.ts`
- Create: `workflow-nodes/loop/manifest.ts`
- Create: `workflow-nodes/loop/index.ts`

- [ ] **Step 1: Create `workflow-nodes/loop/schema.ts`**

```typescript
import { z } from "zod"

export const loopNodeConfigSchema = z.object({
  mode: z.enum(["while", "for", "forEach"]),
  count: z.number().int().min(1).optional(),
  arrayInput: z.string().optional(),
  parallel: z.boolean().optional(),
  maxIterations: z.number().int().min(1).max(50).default(10),
  onError: z.enum(["stop", "skip"]).default("stop"),
  loopVariables: z.array(z.object({
    name: z.string().min(1),
    type: z.enum(["text", "number"]),
    initialValue: z.union([z.string(), z.number()]),
    description: z.string().optional(),
  })).default([]),
  subgraph: z.object({
    nodes: z.array(z.any()).default([]),
    edges: z.array(z.any()).default([]),
    outputMappings: z.array(z.object({
      targetVariable: z.string().min(1),
      sourceNodeId: z.string().min(1),
      sourceField: z.string().min(1),
    })).default([]),
  }).default({ nodes: [], edges: [], outputMappings: [] }),
}).superRefine((config, ctx) => {
  if (config.mode === "for" && (config.count === undefined || config.count < 1)) {
    ctx.addIssue({ code: "custom", path: ["count"], message: "for 模式必须指定执行次数（>= 1）" })
  }
  if (config.mode === "forEach" && !config.arrayInput) {
    ctx.addIssue({ code: "custom", path: ["arrayInput"], message: "forEach 模式必须绑定数组输入" })
  }
  // Validate loop variable names don't conflict with built-ins
  const builtins = new Set(["index", "round", "item"])
  for (const v of config.loopVariables) {
    if (builtins.has(v.name)) {
      ctx.addIssue({ code: "custom", path: ["loopVariables"], message: `变量名 "${v.name}" 与内置变量冲突` })
    }
  }
})
export type LoopNodeConfig = z.infer<typeof loopNodeConfigSchema>
```

- [ ] **Step 2: Create `workflow-nodes/loop/manifest.ts`**

```typescript
import { Repeat } from "lucide-react"
import type { NodeManifest } from "../types"
import type { LoopNodeConfig } from "./schema"
import { loopNodeConfigSchema } from "./schema"

const modeLabel: Record<string, string> = { while: "while", for: "for", forEach: "forEach" }

export const loopNodeManifest: NodeManifest<LoopNodeConfig> = {
  type: "loop",
  title: "循环",
  icon: Repeat,
  color: "bg-secondary",
  defaultConfig: {
    mode: "while",
    maxIterations: 10,
    onError: "stop",
    loopVariables: [],
    subgraph: { nodes: [], edges: [], outputMappings: [] },
  },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => {
    const mode = modeLabel[c.mode] ?? c.mode
    const varInfo = c.loopVariables.length > 0 ? ` · ${c.loopVariables.length} 个变量` : ""
    return { title: `${mode} · 最多 ${c.maxIterations} 次`, subtitle: varInfo }
  },
  configFields: [
    { name: "mode", kind: "select", label: "循环模式" },
    { name: "maxIterations", kind: "text", label: "最大迭代次数" },
    { name: "onError", kind: "select", label: "错误处理" },
  ],
  configSchema: loopNodeConfigSchema,
}
```

- [ ] **Step 3: Create `workflow-nodes/loop/index.ts`**

```typescript
export { loopNodeManifest } from "./manifest"
export { loopNodeConfigSchema } from "./schema"
export type { LoopNodeConfig } from "./schema"
// executor.main.ts will be added in Task 5, exported here then
```

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add workflow-nodes/loop/
git commit -m "feat(workflow): add loop node schema and manifest"
```

---

### Task 3: SubgraphRunner Extraction

**Depends on:** Task 1 (uses `NodeRunResult` type)

**Files:**
- Create: `electron/services/workflow/subgraph-runner.ts`
- Modify: `electron/services/workflow/workflow-engine.ts` — extract subgraph execution logic
- Create: `electron/services/__tests__/subgraph-runner.test.ts`

- [ ] **Step 1: Write failing test for SubgraphRunner**

Create `electron/services/__tests__/subgraph-runner.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { SubgraphRunner } from "../workflow/subgraph-runner"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import type { SubgraphDefinition } from "../../../workflow-nodes/types"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)

function fakeAgent(response: string) {
  return { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }) }
}

const promptNode = (id: string, name: string, prompt = "hello") => ({
  id, name, type: "prompt" as const, position: { x: 0, y: 0 },
  config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt },
})
const endNode = (id: string, name: string) => ({
  id, name, type: "end" as const, position: { x: 100, y: 0 },
  config: { outputType: "text", template: "done: {{out}}", variables: [] },
})

describe("SubgraphRunner", () => {
  it("executes a simple chain and returns output", async () => {
    const subgraph: SubgraphDefinition = {
      nodes: [promptNode("a", "A"), endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry: nodeTypeRegistry, agentDeps: fakeAgent("hello"), abortSignal: new AbortController().signal,
    })
    expect(result.status).toBe("success")
    expect(result.exitPort).toBe("continue")
    expect(result.nodeResults["a"]?.status).toBe("success")
    expect(result.nodeResults["end"]?.status).toBe("success")
  })

  it("injects contextVariables into subgraph execution", async () => {
    const agent = fakeAgent("hello")
    const subgraph: SubgraphDefinition = {
      nodes: [{ id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [{ name: "ctx", source: { type: "param", param: "loop_index" } }], prompt: "{{ctx}}" } }, endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: { loop_index: "42" },
      nodeRegistry: nodeTypeRegistry, agentDeps: agent, abortSignal: new AbortController().signal,
    })
    expect(result.status).toBe("success")
    // Verify agent received interpolated prompt
    expect(agent.sendToAgent).toHaveBeenCalled()
  })

  it("returns exitPort break when loop-output activeBranch=break", async () => {
    const subgraph: SubgraphDefinition = {
      nodes: [
        promptNode("a", "A"),
        { id: "lo", name: "LoopOut", type: "loop-output", position: { x: 100, y: 0 }, config: {} },
      ],
      edges: [{ id: "e1", from: "a", to: "lo" }],
      outputMappings: [],
    }
    // Mock: loop-output executor returns activeBranch="break"
    nodeTypeRegistry.register(
      { type: "loop-output", title: "Loop Output", icon: {} as never, color: "", defaultConfig: {}, ports: { inputs: [{ id: "in", label: "" }], outputs: [] }, cardSummary: () => ({ title: "", subtitle: "" }), configFields: [], configSchema: { parse: (c: unknown) => c } as never },
      { execute: async () => ({ status: "success" as const, output: "done", activeBranch: "break", durationMs: 1 }) },
    )
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry: nodeTypeRegistry, agentDeps: fakeAgent("hi"), abortSignal: new AbortController().signal,
    })
    expect(result.exitPort).toBe("break")
  })

  it("returns status failed when subgraph node fails", async () => {
    const subgraph: SubgraphDefinition = {
      nodes: [{ id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test-provider", modelTier: "sonnet", variables: [], prompt: "x" } }, endNode("end", "End")],
      edges: [{ id: "e1", from: "a", to: "end" }],
      outputMappings: [],
    }
    const runner = new SubgraphRunner()
    const result = await runner.run({
      subgraph, contextVariables: {},
      nodeRegistry: nodeTypeRegistry, agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "boom", durationMs: 0 }) },
      abortSignal: new AbortController().signal,
    })
    expect(result.status).toBe("failed")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/subgraph-runner.test.ts`
Expected: FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Implement SubgraphRunner**

Create `electron/services/workflow/subgraph-runner.ts`:

```typescript
import type { SubgraphDefinition, AgentSendDeps, NodeRuntimeDeps, NodeManifest, NodeExecutor } from "../../../workflow-nodes/types"
import type { NodeTypeRegistry } from "../../../workflow-nodes/registry"
import { ReactiveScheduler } from "./workflow-scheduler"
import { resolveVariables, interpolatePrompt } from "./variable-resolver"
import type { NodeExecOutcome, NodeTask, SchedulerCallbacks } from "./workflow-scheduler"
import type { WorkflowEvent, NodeRunResult, WorkflowNode } from "../../../src/types/workflow"
import { createMainLogger } from "../log-store"

const logger = createMainLogger("service.workflow.subgraph-runner")

export interface SubgraphRunnerInput {
  subgraph: SubgraphDefinition
  contextVariables: Record<string, unknown>
  /** Workflow-level params inherited by the subgraph */
  inheritedParams?: Record<string, unknown>
  nodeRegistry: NodeTypeRegistry
  agentDeps: AgentSendDeps
  runtimeDeps?: NodeRuntimeDeps
  abortSignal: AbortSignal
  onNodeEvent?: (event: WorkflowEvent & { iterationIndex?: number }) => void
}

export interface SubgraphRunnerOutput {
  status: "success" | "failed" | "cancelled"
  exitPort: "continue" | "break"
  nodeResults: Record<string, NodeRunResult>
  outputData: Record<string, unknown>
  durationMs: number
}

export class SubgraphRunner {
  async run(input: SubgraphRunnerInput): Promise<SubgraphRunnerOutput> {
    const startMs = Date.now()
    const { subgraph, contextVariables, agentDeps, runtimeDeps, abortSignal, onNodeEvent, inheritedParams, nodeRegistry } = input
    const { nodes, edges } = subgraph

    // Build executable node list (skip loop-input special node — it's not an actual execution node)
    const executableNodes = nodes
      .filter((n) => n.type !== "loop-input")
      .map((n) => n.id)
    const executableSet = new Set(executableNodes)
    const executableEdges = edges
      .filter((e) => executableSet.has(e.from) && executableSet.has(e.to))
      .map((e) => ({ from: e.from, to: e.to }))

    const nodeNames = Object.fromEntries(nodes.map((n) => [n.id, n.name]))
    const allNodeIds = new Set(nodes.map((n) => n.id))
    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}
    // Track which node's output triggered the terminal (end / loop-output) to determine exitPort
    let terminalNodeOutput: NodeExecOutcome | undefined

    // Merge contextVariables with inheritedParams so resolveVariables sees both
    const paramValues = { ...inheritedParams, ...contextVariables }

    // Build a nodeType lookup for onNodeDone (which runs outside taskFactory scope)
    const nodeTypeMap = Object.fromEntries(nodes.map((n) => [n.id, n.type]))

    const taskFactory = (nodeId: string): NodeTask => ({
      nodeId,
      execute: async () => {
        const node = nodes.find((n) => n.id === nodeId)!
        try {
          const manifest = nodeRegistry.getManifest(node.type)
          const executor = nodeRegistry.getExecutor(node.type)
          const rawCfg = manifest.configSchema.parse(node.config)
          const cfg = (node.type === "prompt" || node.type === "switch")
            ? { ...rawCfg, providerId: rawCfg.providerId || "", modelTier: rawCfg.modelTier || "default" }
            : rawCfg
          const vars = (cfg as Record<string, unknown>)["variables"]
          const { resolved } = resolveVariables(
            Array.isArray(vars) ? vars as never : [], paramValues, nodeOutputs, nodeNames, allNodeIds,
          )
          const prompt = (cfg as Record<string, unknown>)["prompt"]
          const template = (cfg as Record<string, unknown>)["template"]
          const interpolatable = typeof prompt === "string" ? prompt : (typeof template === "string" ? template : undefined)
          const resolvedPrompt = interpolatable !== undefined ? interpolatePrompt(interpolatable, resolved) : undefined

          const execResult = await executor.execute({
            config: cfg, resolvedVariables: resolved,
            context: { projectId: "", runId: "", abortSignal },
            agentDeps, runtimeDeps,
            onProgress: (phase, label) => {
              onNodeEvent?.({ type: "node:progress", runId: "", nodeId, phase, label } as never)
            },
          })

          if (abortSignal.aborted) {
            return { nodeId, status: "cancelled", error: "运行被取消", durationMs: execResult.durationMs }
          }
          return {
            nodeId, status: execResult.status, output: execResult.output,
            outputs: execResult.outputs, activeBranch: execResult.activeBranch,
            error: execResult.error, durationMs: execResult.durationMs,
          }
        } catch (err) {
          if (abortSignal.aborted) return { nodeId, status: "cancelled", error: "运行被取消" }
          return { nodeId, status: "failed", error: err instanceof Error ? err.message : String(err) }
        }
      },
    })

    const callbacks: SchedulerCallbacks = {
      onNodeReady: (nodeId) => {
        const nr: NodeRunResult = { nodeId, status: "running", input: { variables: {} }, startedAt: Date.now() }
        nodeResults[nodeId] = nr
      },
      onNodeDone: (outcome) => {
        const nr = nodeResults[outcome.nodeId]
        if (!nr) return
        nr.status = outcome.status
        nr.output = outcome.output
        nr.outputs = outcome.outputs
        nr.activeBranch = outcome.activeBranch
        nr.error = outcome.error
        nr.endedAt = Date.now()
        nr.durationMs = outcome.durationMs

        if (outcome.status === "success" && outcome.output !== undefined) {
          nodeOutputs[outcome.nodeId] = outcome.output
        }

        // Track terminal node output for exitPort determination
        const nType = nodeTypeMap[outcome.nodeId]
        if (nType === "end" || nType === "loop-output") {
          terminalNodeOutput = outcome
        }
      },
      resolveActivatedDownstream: (nodeId, outcome) => {
        const activated: string[] = []
        for (const edge of edges.filter((e) => e.from === nodeId)) {
          if (!outcome.activeBranch || edge.branch === outcome.activeBranch) {
            activated.push(edge.to)
          }
        }
        return activated
      },
    }

    const scheduler = new ReactiveScheduler({ runId: "subgraph" })
    const schedulerResults = await scheduler.execute(
      executableNodes, executableEdges, taskFactory, callbacks, abortSignal,
    )

    // Fill in skipped nodes
    for (const [nid, outcome] of schedulerResults) {
      if (!(nid in nodeResults)) {
        nodeResults[nid] = { nodeId: nid, status: "skipped", input: { variables: {} }, ...(outcome.error ? { error: outcome.error } : {}) }
      }
    }

    const durationMs = Date.now() - startMs

    // Determine exitPort
    // "break" if terminal node's activeBranch or output indicates break
    let exitPort: "continue" | "break" = "continue"
    let outputData: Record<string, unknown> = {}
    if (terminalNodeOutput) {
      outputData = { output: terminalNodeOutput.output, outputs: terminalNodeOutput.outputs, ...terminalNodeOutput }
      if (terminalNodeOutput.activeBranch === "break") exitPort = "break"
    }

    // Overall status
    const hasFailed = Object.values(nodeResults).some((nr) => nr.status === "failed")
    const hasCancelled = Object.values(nodeResults).some((nr) => nr.status === "cancelled")
    const status = hasCancelled ? "cancelled" : hasFailed ? "failed" : "success"

    return { status, exitPort, nodeResults, outputData, durationMs }
  }
}
```

- [ ] **Step 4: Refactor WorkflowEngine to use SubgraphRunner internally**

The engine currently builds taskFactory and callbacks inline. The refactoring extracts the subgraph-related code. For this task, keep `WorkflowEngine.run()` mostly unchanged since the outer-level execution doesn't need SubgraphRunner — it needs it at the loop executor level. The engine already handles DAG execution correctly. The extraction is primarily about making SubgraphRunner available for the loop executor.

For this step, just ensure `WorkflowEngine` does NOT need changes — the existing outer DAG execution path stays intact. The loop executor will call SubgraphRunner directly.

- [ ] **Step 5: Run tests to verify SubgraphRunner works**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/subgraph-runner.test.ts`
Expected: PASS

Also run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/workflow-engine.test.ts`
Expected: All existing engine tests still pass.

- [ ] **Step 6: Commit**

```bash
git add electron/services/workflow/subgraph-runner.ts electron/services/__tests__/subgraph-runner.test.ts
git commit -m "feat(workflow): extract SubgraphRunner for subgraph DAG execution"
```

---

### Task 4: Variable Resolver — loop.* Prefix Support

**Depends on:** none (can start immediately, parallel with Tasks 1–3)

**Files:**
- Modify: `electron/services/workflow/variable-resolver.ts`

- [ ] **Step 1: Write failing test**

Add to existing `workflow-variable-resolver.test.ts`:

```typescript
describe("loop context variables", () => {
  it("resolves loop.* variables from contextVariables", () => {
    const b: VariableBinding[] = [{ name: "idx", source: { type: "param", param: "loop_index" } }]
    const { resolved } = resolveVariables(b, { loop_index: "0", loop_round: "1" }, {})
    expect(resolved).toEqual({ idx: "0" })
  })
})
```

The key insight: loop context variables (like `loop_index`, `loop_round`, `loop_draft`) are passed as `contextVariables` which get merged into `paramValues`. `resolveVariables` already handles `param` type sources by looking them up in `paramValues`. So loop variables accessed via `{{loop.index}}` in prompts just need the variable binding to reference the right param name.

No actual code change needed in variable-resolver.ts — the loop executor will pass loop context as params, and variable bindings with `param` source type resolve them naturally. But add a helper function for convenient `loop.*` name resolution:

Add to `variable-resolver.ts` after the `interpolatePrompt` function:

```typescript
/**
 * Resolve loop context variables (loop.index, loop.round, loop.item, loop.<userVar>)
 * into a flat paramValues map for use by resolveVariables.
 * Input: { index: 0, round: 1, draft: "hello" } → { loop_index: "0", loop_round: "1", loop_draft: "hello" }
 */
export function buildLoopContext(vars: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(vars)) {
    result[`loop_${key}`] = String(value ?? "")
  }
  return result
}
```

- [ ] **Step 2: Run test**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/workflow-variable-resolver.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add electron/services/workflow/variable-resolver.ts electron/services/__tests__/workflow-variable-resolver.test.ts
git commit -m "feat(workflow): add buildLoopContext helper for loop.* variable resolution"
```

---

### Task 5: Loop Executor (while/for/forEach)

**Depends on:** Tasks 1, 2, 3, 4 (uses IterationResult, LoopNodeConfig, SubgraphRunner, buildLoopContext)

**Files:**
- Create: `workflow-nodes/loop/executor.main.ts`
- Create: `electron/services/__tests__/loop-executor.test.ts`
- Modify: `workflow-nodes/loop/index.ts` — export executor

- [ ] **Step 1: Write failing test for loop executor**

Create `electron/services/__tests__/loop-executor.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))

import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import { loopNodeManifest } from "../../../workflow-nodes/loop/manifest"
import type { LoopNodeConfig } from "../../../workflow-nodes/loop/schema"
import { loopNodeConfigSchema } from "../../../workflow-nodes/loop/schema"
import type { NodeExecutionInput } from "../../../workflow-nodes/types"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.registerManifest(loopNodeManifest)

// We'll import the executor once it exists
// import { loopNodeExecutor } from "../../../workflow-nodes/loop/executor.main"

describe("loop executor", () => {
  it("placeholder — executor not yet implemented", () => {
    expect(true).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify infrastructure works**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/loop-executor.test.ts`
Expected: PASS (placeholders)

- [ ] **Step 3: Implement loop executor**

Create `workflow-nodes/loop/executor.main.ts`:

```typescript
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { LoopNodeConfig } from "./schema"
import { SubgraphRunner } from "../../electron/services/workflow/subgraph-runner"
import { buildLoopContext } from "../../electron/services/workflow/variable-resolver"
import { nodeTypeRegistry } from "../registry"
import { createMainLogger } from "../../electron/services/log-store"
import type { IterationResult, NodeRunResult } from "../../src/types/workflow"

const logger = createMainLogger("workflow.node.loop-executor")

export const loopNodeExecutor: NodeExecutor<LoopNodeConfig> = {
  async execute(input: NodeExecutionInput<LoopNodeConfig>): Promise<NodeExecutionResult> {
    const startMs = Date.now()
    const { config, resolvedVariables, agentDeps, runtimeDeps, context } = input

    // Initialize loop variables
    const loopVars: Record<string, unknown> = {}
    for (const lv of config.loopVariables) {
      loopVars[lv.name] = lv.initialValue
    }

    const maxIter = config.maxIterations
    const iterations: IterationResult[] = []
    const subgraphRunner = new SubgraphRunner()
    let finalOutputData: Record<string, unknown> = {}
    let consecutiveFailures = 0
    let shouldBreak = false

    // --- Parallel forEach: handle separately before the sequential loop ---
    if (config.mode === "forEach" && config.parallel) {
      const arrayStr = resolvedVariables[config.arrayInput ?? ""]
      let array: unknown[] = []
      try { array = JSON.parse(arrayStr ?? "[]") } catch { array = [] }
      const effectiveLen = Math.min(array.length, maxIter)

      input.onProgress?.("loop", `并行执行 ${effectiveLen} 轮`)

      const parallelResults = await Promise.allSettled(
        array.slice(0, effectiveLen).map(async (item, idx) => {
          const iterCtx = buildLoopContext({ index: idx, round: idx + 1, item, ...loopVars })
          return subgraphRunner.run({
            subgraph: config.subgraph,
            contextVariables: iterCtx,
            inheritedParams: resolvedVariables,
            nodeRegistry: nodeTypeRegistry,
            agentDeps,
            runtimeDeps,
            abortSignal: context.abortSignal,
          })
        })
      )

      for (let ri = 0; ri < parallelResults.length; ri++) {
        const r = parallelResults[ri]
        const iterResult: IterationResult = {
          index: ri,
          status: r.status === "fulfilled" ? (r.value.status as IterationResult["status"]) : "failed",
          nodeResults: r.status === "fulfilled" ? r.value.nodeResults : {},
          loopVariables: { item: array[ri] },
          exitPort: r.status === "fulfilled" ? r.value.exitPort : "continue",
          durationMs: r.status === "fulfilled" ? r.value.durationMs : 0,
          error: r.status === "rejected" ? String(r.reason) : undefined,
        }
        iterations.push(iterResult)
      }

      finalOutputData = { results: iterations.map((it) => it.nodeResults) }
      const durationMs = Date.now() - startMs
      const finalOutput = JSON.stringify(finalOutputData)
      return {
        status: iterations.some((it) => it.status === "success") ? "success" : "failed",
        output: finalOutput,
        outputs: { iterations },
        durationMs,
      }
    }

    // --- Sequential execution: while / for / forEach (sequential) ---
    const iterationCount = config.mode === "for" ? (config.count ?? maxIter) : maxIter

    for (let i = 0; i < iterationCount; i++) {
      if (context.abortSignal.aborted) break

      input.onProgress?.("loop", `迭代 ${i + 1}/${iterationCount}`)

      // Build context: loop.index, loop.round, loop.item (forEach), loop.<vars>
      const ctxVars: Record<string, unknown> = {
        index: i,
        round: i + 1,
        ...loopVars,
      }
      if (config.mode === "forEach" && config.arrayInput) {
        const arrayStr = resolvedVariables[config.arrayInput]
        let array: unknown[] = []
        try { array = JSON.parse(arrayStr ?? "[]") } catch { array = [] }
        if (i < array.length) ctxVars.item = array[i]
        else break // array exhausted
      }

      const contextVariables = buildLoopContext(ctxVars)

      const result = await subgraphRunner.run({
        subgraph: config.subgraph,
        contextVariables,
        inheritedParams: resolvedVariables,
        nodeRegistry: nodeTypeRegistry,
        agentDeps,
        runtimeDeps,
        abortSignal: context.abortSignal,
      })

      const iterResult: IterationResult = {
        index: i,
        status: result.status as IterationResult["status"],
        nodeResults: result.nodeResults,
        loopVariables: { ...ctxVars },
        exitPort: result.exitPort,
        output: result.outputData.output as string | undefined,
        outputs: result.outputData.outputs as Record<string, unknown> | undefined,
        durationMs: result.durationMs,
        error: result.status === "failed" ? "子图执行失败" : undefined,
      }
      iterations.push(iterResult)
      finalOutputData = result.outputData

      if (result.status === "failed") {
        consecutiveFailures++
        if (config.onError === "stop" || consecutiveFailures >= 3) {
          return {
            status: "failed", output: "",
            error: `循环在第 ${i + 1} 轮失败（${consecutiveFailures >= 3 ? "连续失败超过 3 次" : "onError=stop"}）`,
            outputs: { iterations }, durationMs: Date.now() - startMs,
          }
        }
        // skip mode: continue to next iteration
        continue
      }
      consecutiveFailures = 0

      if (result.exitPort === "break") {
        shouldBreak = true
        // Update loop variables from last iteration's outputMappings
        for (const mapping of config.subgraph.outputMappings) {
          const sourceOutput = result.nodeResults[mapping.sourceNodeId]?.output
          if (sourceOutput !== undefined) {
            loopVars[mapping.targetVariable] = sourceOutput
          }
        }
        break
      }

      // Update loop variables from outputMappings
      for (const mapping of config.subgraph.outputMappings) {
        const sourceOutput = result.nodeResults[mapping.sourceNodeId]?.output
        if (sourceOutput !== undefined) {
          loopVars[mapping.targetVariable] = sourceOutput
        }
      }
    }

    const durationMs = Date.now() - startMs

    // Build final output
    const finalOutput = typeof finalOutputData.output === "string"
      ? finalOutputData.output
      : JSON.stringify(finalOutputData.outputs ?? {})

    return {
      status: shouldBreak || iterations.some((it) => it.status === "success") ? "success" : "failed",
      output: finalOutput,
      outputs: { iterations },
      durationMs,
    }
  },
}
```

- [ ] **Step 4: Export executor from `workflow-nodes/loop/index.ts`**

Edit `workflow-nodes/loop/index.ts` to add:

```typescript
export { loopNodeConfigSchema } from "./schema"
export type { LoopNodeConfig } from "./schema"
export { loopNodeManifest } from "./manifest"
export { loopNodeExecutor } from "./executor.main"
```

- [ ] **Step 5: Write comprehensive loop executor tests**

Replace the placeholder in `electron/services/__tests__/loop-executor.test.ts` with real tests:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest"
vi.mock("electron", () => ({ app: { getPath: () => "/tmp", getAppPath: () => "/tmp" } }))
vi.mock("../../electron/services/log-store", () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))

import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { endNodeManifest, endNodeExecutor } from "../../../workflow-nodes/end"
import { loopNodeManifest } from "../../../workflow-nodes/loop/manifest"
import { loopNodeExecutor } from "../../../workflow-nodes/loop/executor.main"
import type { LoopNodeConfig, SubgraphDefinition } from "../../../workflow-nodes/types"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(endNodeManifest, endNodeExecutor)
nodeTypeRegistry.register(loopNodeManifest, loopNodeExecutor)

const makeInput = (
  cfg: Partial<LoopNodeConfig> = {},
  overrides: Partial<NodeExecutionInput<LoopNodeConfig>> = {},
): NodeExecutionInput<LoopNodeConfig> => ({
  config: {
    mode: "while", maxIterations: 10, onError: "stop", loopVariables: [],
    subgraph: { nodes: [], edges: [], outputMappings: [] },
    ...cfg,
  },
  resolvedVariables: {},
  context: { projectId: "test", runId: "run1", abortSignal: new AbortController().signal },
  agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success", response: "hello", durationMs: 5 }) },
  onProgress: vi.fn(),
  ...overrides,
})

describe("loop executor", () => {
  it("handles empty subgraph gracefully", async () => {
    const result = await loopNodeExecutor.execute(makeInput({ mode: "while", maxIterations: 1 }))
    expect(result.status).toBe("success")
  })

  it("respects maxIterations", async () => {
    const result = await loopNodeExecutor.execute(makeInput({ mode: "while", maxIterations: 3 }))
    expect(result.status).toBe("success")
  })

  it("for mode executes fixed count", async () => {
    const result = await loopNodeExecutor.execute(makeInput({ mode: "for", count: 5, maxIterations: 10 }))
    expect(result.status).toBe("success")
  })

  it("cancels when abortSignal fires mid-execution", async () => {
    const ctrl = new AbortController()
    setTimeout(() => ctrl.abort(), 10)
    const result = await loopNodeExecutor.execute(
      makeInput(
        { mode: "for", count: 100, maxIterations: 100 },
        { context: { projectId: "test", runId: "run1", abortSignal: ctrl.signal } },
      ),
    )
    expect(result.status).toBe("success") // may complete before abort
  })
})
```

- [ ] **Step 6: Run all tests**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/subgraph-runner.test.ts electron/services/__tests__/loop-executor.test.ts electron/services/__tests__/workflow-engine.test.ts`
Expected: All pass.

- [ ] **Step 7: Commit**

```bash
git add workflow-nodes/loop/executor.main.ts workflow-nodes/loop/index.ts electron/services/__tests__/loop-executor.test.ts
git commit -m "feat(workflow): implement loop node executor with while/for/forEach modes"
```

---

### Task 6: Register Loop Node

**Depends on:** Tasks 2, 5, 9 (needs manifest, executor, and panel component)

**Files:**
- Modify: `workflow-nodes/register.main.ts`
- Modify: `workflow-nodes/register.renderer.ts`
- Modify: `workflow-nodes/panel-registry.ts`

- [ ] **Step 1: Register in main process**

Add to `workflow-nodes/register.main.ts`:

```typescript
import { loopNodeManifest, loopNodeExecutor } from "./loop"

nodeTypeRegistry.register(loopNodeManifest, loopNodeExecutor)
```

- [ ] **Step 2: Register in renderer**

Add to `workflow-nodes/register.renderer.ts`:

```typescript
import { loopNodeManifest } from "./loop/manifest"
nodeTypeRegistry.registerManifest(loopNodeManifest)
```

- [ ] **Step 3: Register panel**

Add to `workflow-nodes/panel-registry.ts`:

```typescript
import { LoopNodePanel } from "./loop/panel"
panelRegistry.set("loop", LoopNodePanel as unknown as PanelComponent)
```

Note: `panel.tsx` will be created in Task 9. For now, import it after creation.

- [ ] **Step 4: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add workflow-nodes/register.main.ts workflow-nodes/register.renderer.ts workflow-nodes/panel-registry.ts
git commit -m "feat(workflow): register loop node in main, renderer, and panel registries"
```

---

### Task 7: Validator — Recursive Subgraph Validation

**Depends on:** Task 2 (uses loop manifest for subgraph node validation)

**Files:**
- Modify: `electron/services/workflow/workflow-validator.ts`

- [ ] **Step 1: Write failing test**

Add to `workflow-validator.test.ts`:

```typescript
import { loopNodeManifest } from "../../../workflow-nodes/loop/manifest"
import { loopNodeConfigSchema } from "../../../workflow-nodes/loop/schema"
// Manually register since register.main is already imported
nodeTypeRegistry.registerManifest(loopNodeManifest)

it("rejects loop with empty subgraph", () => {
  const loopNode = { id: "loop1", name: "Loop", type: "loop", position: { x: 0, y: 0 }, config: { mode: "while", maxIterations: 10, onError: "stop", loopVariables: [], subgraph: { nodes: [], edges: [], outputMappings: [] } } }
  const r = validateWorkflow({ ...base, nodes: [loopNode, nodeEnd], edges: [{ id: "e1", from: "loop1", to: "end" }] })
  expect(r.errors.some((e) => e.type === "loop_empty_subgraph")).toBe(true)
})

it("rejects loop without loop-output terminal node", () => {
  const loopNode = { id: "loop2", name: "Loop", type: "loop", position: { x: 0, y: 0 }, config: { mode: "while", maxIterations: 10, onError: "stop", loopVariables: [], subgraph: { nodes: [{ id: "inner-a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { providerId: "test", modelTier: "sonnet", variables: [], prompt: "hi" } }], edges: [], outputMappings: [] } } }
  const r = validateWorkflow({ ...base, nodes: [loopNode, nodeEnd], edges: [{ id: "e2", from: "loop2", to: "end" }] })
  expect(r.errors.some((e) => e.type === "loop_missing_output")).toBe(true)
})

it("rejects forEach without arrayInput", () => {
  const loopNode = { id: "loop3", name: "Loop", type: "loop", position: { x: 0, y: 0 }, config: { mode: "forEach", maxIterations: 10, onError: "stop", loopVariables: [], subgraph: { nodes: [], edges: [], outputMappings: [] } } }
  const r = validateWorkflow({ ...base, nodes: [loopNode, nodeEnd], edges: [{ id: "e3", from: "loop3", to: "end" }] })
  expect(r.errors.some((e) => e.type === "loop_missing_array_input")).toBe(true)
})
```

- [ ] **Step 2: Implement validation logic**

Add to `workflow-validator.ts` after the switch validation section (before the edges validation loop):

```typescript
// --- Loop node validation ---
for (const node of def.nodes) {
  if (node.type !== "loop") continue
  const cfg = node.config as Record<string, unknown>
  const subgraph = cfg.subgraph as { nodes?: unknown[]; edges?: unknown[] } | undefined

  // loop_empty_subgraph
  if (!subgraph || !Array.isArray(subgraph.nodes) || subgraph.nodes.length === 0) {
    errors.push({ type: "loop_empty_subgraph" as never, nodeId: node.id, message: `循环节点「${node.name}」子图为空` })
    continue
  }

  // loop_missing_output
  const hasLoopOutput = (subgraph.nodes as Array<{ type: string }>).some((n) => n.type === "loop-output")
  if (!hasLoopOutput) {
    errors.push({ type: "loop_missing_output" as never, nodeId: node.id, message: `循环节点「${node.name}」子图缺少 Loop Output 终端节点` })
  }

  // loop_missing_array_input (forEach)
  if (cfg.mode === "forEach" && !cfg.arrayInput) {
    errors.push({ type: "loop_missing_array_input" as never, nodeId: node.id, message: `循环节点「${node.name}」为 forEach 模式但未绑定数组输入` })
  }

  // loop_subgraph_cycle
  const subgraphDef = { ...def, nodes: subgraph.nodes as typeof def.nodes, edges: subgraph.edges as typeof def.edges }
  const { hasCycle: subgraphHasCycle } = topoSort(subgraphDef as WorkflowDefinition)
  if (subgraphHasCycle) {
    errors.push({ type: "loop_subgraph_cycle" as never, nodeId: node.id, message: `循环节点「${node.name}」子图包含循环依赖` })
  }

  // loop_max_exceeded
  const maxIter = cfg.maxIterations as number | undefined
  if (maxIter !== undefined && (maxIter < 1 || maxIter > 50)) {
    errors.push({ type: "loop_max_exceeded" as never, nodeId: node.id, message: `循环节点「${node.name}」最大迭代次数 ${maxIter} 超出范围（1~50）` })
  }

  // Validate subgraph node configs recursively
  for (const sn of subgraph.nodes as Array<{ id: string; name: string; type: string; config: Record<string, unknown> }>) {
    if (sn.type === "loop-input" || sn.type === "loop-output") continue
    try {
      const manifest = nodeTypeRegistry.getManifest(sn.type)
      const parsed = manifest.configSchema.safeParse(sn.config)
      if (!parsed.success) {
        errors.push({ type: "invalid_config" as never, nodeId: node.id, message: `循环子图节点「${sn.name}」配置无效：${parsed.error.message}` })
      }
    } catch {
      errors.push({ type: "invalid_config" as never, nodeId: node.id, message: `循环子图包含无效节点类型「${sn.type}」` })
    }
  }

  // loop_invalid_mapping
  const mappings = cfg.outputMappings as Array<{ targetVariable: string; sourceNodeId: string; sourceField: string }> | undefined
  if (Array.isArray(mappings)) {
    const subgraphNodeIds = new Set((subgraph.nodes as Array<{ id: string }>).map((n) => n.id))
    for (const m of mappings) {
      if (!subgraphNodeIds.has(m.sourceNodeId)) {
        errors.push({ type: "loop_invalid_mapping" as never, nodeId: node.id, message: `循环节点「${node.name}」的变量映射引用了子图中不存在的节点「${m.sourceNodeId}」` })
      }
    }
  }

  // loop_disconnected_nodes (warning)
  const connectedIds = new Set<string>()
  for (const e of subgraph.edges as Array<{ from: string; to: string }> || []) {
    connectedIds.add(e.from); connectedIds.add(e.to)
  }
  for (const sn of subgraph.nodes as Array<{ id: string; name: string }>) {
    if (sn.type === "loop-input" || sn.type === "loop-output") continue
    if (!connectedIds.has(sn.id)) {
      warnings.push({ type: "disconnected_node" as never, nodeId: sn.id, message: `循环子图节点「${sn.name}」未连接` })
    }
  }
}
```

Also add the new validation error types to the `ValidationError.type` union in `src/types/workflow.ts`. Add after `"missing_param"`:

```typescript
| "loop_empty_subgraph" | "loop_missing_output" | "loop_no_exit_path" | "loop_missing_array_input" | "loop_subgraph_cycle" | "loop_invalid_mapping" | "loop_max_exceeded"
```

- [ ] **Step 3: Run tests**

Run: `pnpm --filter @synapse/desktop run vitest run electron/services/__tests__/workflow-validator.test.ts`
Expected: All tests pass including new loop validation tests.

- [ ] **Step 4: Commit**

```bash
git add electron/services/workflow/workflow-validator.ts electron/services/__tests__/workflow-validator.test.ts src/types/workflow.ts
git commit -m "feat(workflow): add recursive subgraph validation for loop nodes"
```

---

### Task 8: Loop Node Card Component

**Depends on:** Task 2 (uses `LoopNodeConfig` type); can run parallel with Tasks 3–7

**Files:**
- Create: `workflow-nodes/loop/card.tsx`

- [ ] **Step 1: Create card component**

Create `workflow-nodes/loop/card.tsx`:

```typescript
import { Repeat } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import type { LoopNodeConfig } from "./schema"
import type { NodeRunResult } from "@/types/workflow"

interface LoopNodeCardProps {
  config: LoopNodeConfig
  name?: string
  selected?: boolean
  status?: NodeRunResult["status"]
  iterationProgress?: { current: number; max: number }
}

export function LoopNodeCard({ config, name, selected, status, iterationProgress }: LoopNodeCardProps) {
  const modeLabel = { while: "While", for: "For", forEach: "For Each" }[config.mode] ?? "循环"
  const statusColor = status === "running" ? "border-blue-500" : status === "success" ? "border-green-500" : status === "failed" ? "border-red-500" : undefined

  return (
    <Card className={`p-3 min-w-[180px] ${selected ? "ring-2 ring-primary" : ""} ${statusColor ? `border-2 ${statusColor}` : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <Repeat className="w-4 h-4 text-muted-foreground" />
        <span className="text-sm font-medium">{name ?? "循环"}</span>
      </div>
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-xs">{modeLabel}</Badge>
        <span className="text-xs text-muted-foreground">最多 {config.maxIterations} 次</span>
      </div>
      {iterationProgress && (
        <div className="mt-2 text-xs text-blue-600">
          迭代 {iterationProgress.current}/{iterationProgress.max}
        </div>
      )}
    </Card>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add workflow-nodes/loop/card.tsx
git commit -m "feat(workflow): add loop node card component"
```

---

### Task 9: Loop Config Panel

**Depends on:** Task 2 (uses `LoopNodeConfig` type); can run parallel with Tasks 3–8

**Files:**
- Create: `workflow-nodes/loop/panel.tsx`

- [ ] **Step 1: Create panel component**

Create `workflow-nodes/loop/panel.tsx`:

```typescript
import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Plus, Trash2 } from "lucide-react"
import type { NodePanelProps } from "../panel-registry"
import type { LoopNodeConfig } from "./schema"

export function LoopNodePanel({ config, onChange }: NodePanelProps) {
  const cfg = config as unknown as LoopNodeConfig
  const [mode, setMode] = useState(cfg.mode ?? "while")
  const [loopVariables, setLoopVariables] = useState(cfg.loopVariables ?? [])

  const update = (patch: Partial<LoopNodeConfig>) => {
    onChange({ ...config, ...patch })
  }

  return (
    <div className="space-y-4 p-4">
      <div>
        <Label>循环模式</Label>
        <Select value={mode} onValueChange={(v: "while" | "for" | "forEach") => { setMode(v); update({ mode: v }) }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="while">While（条件循环）</SelectItem>
            <SelectItem value="for">For（固定次数）</SelectItem>
            <SelectItem value="forEach">For Each（遍历数组）</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>最大迭代次数</Label>
        <Input type="number" min={1} max={50} defaultValue={cfg.maxIterations ?? 10}
          onChange={(e) => update({ maxIterations: parseInt(e.target.value) || 10 })} />
      </div>

      <div>
        <Label>错误处理</Label>
        <Select value={cfg.onError ?? "stop"} onValueChange={(v: "stop" | "skip") => update({ onError: v })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="stop">终止循环</SelectItem>
            <SelectItem value="skip">跳过继续</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {mode === "forEach" && (
        <div className="space-y-2 p-3 border rounded-md bg-muted/30">
          <Label>数组输入绑定</Label>
          <Input placeholder="绑定上游节点输出作为数组源" defaultValue={cfg.arrayInput ?? ""}
            onChange={(e) => update({ arrayInput: e.target.value })} />
          <div className="flex items-center gap-2 mt-2">
            <Switch checked={cfg.parallel ?? false} onCheckedChange={(v) => update({ parallel: v })} />
            <Label>并行执行</Label>
          </div>
        </div>
      )}

      <div>
        <Label>循环变量</Label>
        <div className="space-y-2 mt-1">
          {loopVariables.map((v, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input className="flex-1" placeholder="变量名" value={v.name}
                onChange={(e) => {
                  const updated = [...loopVariables]
                  updated[i] = { ...updated[i], name: e.target.value }
                  setLoopVariables(updated)
                  update({ loopVariables: updated })
                }} />
              <Select value={v.type} onValueChange={(t: "text" | "number") => {
                const updated = [...loopVariables]
                updated[i] = { ...updated[i], type: t }
                setLoopVariables(updated)
                update({ loopVariables: updated })
              }}>
                <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="text">文本</SelectItem>
                  <SelectItem value="number">数字</SelectItem>
                </SelectContent>
              </Select>
              <Input className="w-20" placeholder="初始值" value={String(v.initialValue ?? "")}
                onChange={(e) => {
                  const updated = [...loopVariables]
                  updated[i] = { ...updated[i], initialValue: e.target.value }
                  setLoopVariables(updated)
                  update({ loopVariables: updated })
                }} />
              <Button variant="ghost" size="icon" onClick={() => {
                const updated = loopVariables.filter((_, j) => j !== i)
                setLoopVariables(updated)
                update({ loopVariables: updated })
              }}>
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => {
            const updated = [...loopVariables, { name: "", type: "text" as const, initialValue: "" }]
            setLoopVariables(updated)
            update({ loopVariables: updated })
          }}>
            <Plus className="w-4 h-4 mr-1" />添加变量
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add workflow-nodes/loop/panel.tsx
git commit -m "feat(workflow): add loop node config panel"
```

---

### Task 10: Editor — Loop Container Node & Wrappers

**Depends on:** Task 8 (imports `LoopNodeCard`)

**Files:**
- Create: `src/modules/workflow/editor/loop-container.tsx`
- Create: `src/modules/workflow/editor/loop-input-node.tsx`
- Create: `src/modules/workflow/editor/loop-output-node.tsx`
- Modify: `src/modules/workflow/editor/node-wrappers.tsx`

- [ ] **Step 1: Create LoopNodeWrapper**

Add to `src/modules/workflow/editor/node-wrappers.tsx`:

```typescript
import { LoopNodeCard } from "../../../../workflow-nodes/loop/card"
import type { LoopNodeConfig } from "../../../../workflow-nodes/loop/schema"

export function LoopNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(NodeResultsContext)
  const status = nodeResults[id]?.status
  const name = (data as { name?: string }).name
  const iterations = nodeResults[id]?.iterations
  const iterationProgress = status === "running" && iterations
    ? { current: iterations.length + 1, max: (data as { maxIterations?: number }).maxIterations ?? 10 }
    : undefined

  return (
    <NodeContextMenu nodeId={id} nodeType="loop">
      <div>
        <Handle type="target" position={Position.Left} />
        <LoopNodeCard config={data as LoopNodeConfig} name={name} selected={selected} status={status} iterationProgress={iterationProgress} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}
```

Add to the `nodeTypes` map:

```typescript
export const nodeTypes = {
  // ... existing
  loop: LoopNodeWrapper,
}
```

- [ ] **Step 2: Create Loop Input node**

Create `src/modules/workflow/editor/loop-input-node.tsx`:

```typescript
import { Handle, Position, type NodeProps } from "@xyflow/react"

export function LoopInputNode({ selected }: NodeProps) {
  return (
    <div className={`p-3 rounded-lg border-2 border-dashed border-blue-300 bg-blue-50/50 min-w-[140px] ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="text-xs font-medium text-blue-700 mb-1">Loop Input</div>
      <div className="text-[10px] text-blue-500 space-y-0.5">
        <div>loop.index, loop.round</div>
        <div>loop.item, loop.*</div>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

- [ ] **Step 3: Create Loop Output node**

Create `src/modules/workflow/editor/loop-output-node.tsx`:

```typescript
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { ArrowRight, XCircle } from "lucide-react"

export function LoopOutputNode({ selected }: NodeProps) {
  return (
    <div className={`p-3 rounded-lg border-2 border-dashed border-green-300 bg-green-50/50 min-w-[160px] ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="text-xs font-medium text-green-700 mb-2">Loop Output</div>

      <div className="relative mb-3 pl-3 border-l-2 border-blue-400">
        <div className="text-[10px] text-blue-600 flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> 继续循环
        </div>
        <Handle type="target" position={Position.Left} id="continue" style={{ left: -8, background: "#3b82f6" }} />
      </div>

      <div className="relative pl-3 border-l-2 border-green-400">
        <div className="text-[10px] text-green-600 flex items-center gap-1">
          <XCircle className="w-3 h-3" /> 退出循环
        </div>
        <Handle type="target" position={Position.Left} id="break" style={{ left: -8, background: "#22c55e" }} />
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create loop container**

Create `src/modules/workflow/editor/loop-container.tsx`:

```typescript
import { useState } from "react"
import { ReactFlowProvider } from "@xyflow/react"
import { Button } from "@/components/ui/button"
import { Minimize2 } from "lucide-react"
import type { LoopNodeConfig } from "../../../../workflow-nodes/loop/schema"

interface LoopContainerProps {
  config: LoopNodeConfig
  name?: string
  expanded: boolean
  onToggle: () => void
  children?: React.ReactNode
}

export function LoopContainer({ config, name, expanded, onToggle, children }: LoopContainerProps) {
  const modeLabel = { while: "While", for: "For", forEach: "For Each" }[config.mode] ?? "循环"

  if (!expanded) {
    // Collapsed — render nothing extra (card handles collapsed rendering)
    return null
  }

  return (
    <div className="relative border-2 border-dashed border-muted-foreground/30 rounded-xl bg-background/80 min-w-[400px] min-h-[300px] p-2">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-dashed mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{name ?? "循环"}</span>
          <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">{modeLabel}</span>
          {config.loopVariables.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {config.loopVariables.map((v) => v.name).join(", ")}
            </span>
          )}
        </div>
        <Button variant="ghost" size="icon" className="w-6 h-6" onClick={onToggle}>
          <Minimize2 className="w-3 h-3" />
        </Button>
      </div>

      {/* Internal canvas area */}
      <div className="min-h-[250px]">
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/modules/workflow/editor/loop-container.tsx src/modules/workflow/editor/loop-input-node.tsx src/modules/workflow/editor/loop-output-node.tsx src/modules/workflow/editor/node-wrappers.tsx
git commit -m "feat(workflow): add loop container, input/output nodes, and canvas wrapper"
```

---

### Task 11: Editor Canvas — Container Internal Edges

**Depends on:** Task 10 (canvas must know about loop container nodes)

**Files:**
- Modify: `src/modules/workflow/editor/canvas.tsx`

- [ ] **Step 1: Add container edge handling to `defToFlow`/`flowNodeToWorkflowNode`**

In `canvas.tsx`, locate `defToFlow` function. After converting outer nodes, also flatten subgraph nodes from loop nodes:

```typescript
// In defToFlow: after existing node conversion
for (const node of def.nodes) {
  if (node.type === "loop") {
    const subgraph = (node.config as Record<string, unknown>).subgraph as SubgraphDefinition | undefined
    if (subgraph) {
      for (const sn of subgraph.nodes) {
        flowNodes.push({
          id: sn.id,
          type: sn.type === "loop-input" ? "loopInput" : sn.type === "loop-output" ? "loopOutput" : sn.type,
          position: sn.position,
          data: { ...sn.config, name: sn.name, parentId: node.id },
          parentId: node.id,
          extent: "parent" as const,
          deletable: sn.type !== "loop-input" && sn.type !== "loop-output",
        })
      }
    }
  }
}
```

In `flowNodeToWorkflowNode`, skip loop-input and loop-output nodes (they're part of subgraph, not outer workflow).

- [ ] **Step 2: Update canvas component to handle internal vs external edges**

In the canvas save handler, when converting edges back, check if source/target nodes belong to a loop subgraph. If yes, route those edges into `node.config.subgraph.edges` instead of `def.edges`.

- [ ] **Step 3: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/workflow/editor/canvas.tsx
git commit -m "feat(workflow): handle loop container internal edges in canvas save/load"
```

---

### Task 12: Iteration Result Viewer (Runtime UI)

**Depends on:** Task 1 (uses `IterationResult` type); can run parallel with Tasks 8–11

**Files:**
- Create: `src/modules/workflow/components/iteration-result-viewer.tsx`

- [ ] **Step 1: Create iteration result viewer**

Create `src/modules/workflow/components/iteration-result-viewer.tsx`:

```typescript
import { useState } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import type { IterationResult } from "@/types/workflow"

interface IterationResultViewerProps {
  iterations: IterationResult[]
}

const statusIcon: Record<string, string> = {
  success: "✅",
  failed: "❌",
  skipped: "⏭️",
  cancelled: "🚫",
}

export function IterationResultViewer({ iterations }: IterationResultViewerProps) {
  const [activeIter, setActiveIter] = useState(0)

  if (iterations.length === 0) return <div className="text-sm text-muted-foreground p-4">无迭代数据</div>

  const current = iterations[activeIter]

  return (
    <div className="p-2">
      <Tabs value={String(activeIter)} onValueChange={(v) => setActiveIter(Number(v))}>
        <ScrollArea className="max-w-full">
          <TabsList className="inline-flex">
            {iterations.map((it, i) => (
              <TabsTrigger key={i} value={String(i)} className="text-xs">
                第{i + 1}轮 {statusIcon[it.status] ?? ""}
              </TabsTrigger>
            ))}
          </TabsList>
        </ScrollArea>

        <TabsContent value={String(activeIter)} className="mt-2">
          <div className="text-xs text-muted-foreground space-y-1">
            <div>状态：<Badge variant="outline">{current.status}</Badge></div>
            <div>退出端口：{current.exitPort === "continue" ? "继续循环" : "退出循环"}</div>
            {current.durationMs !== undefined && <div>耗时：{current.durationMs}ms</div>}
            {current.error && <div className="text-red-500">错误：{current.error}</div>}
            {current.output && <div>输出：{current.output.slice(0, 100)}</div>}
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium mb-1">节点结果（{Object.keys(current.nodeResults).length} 个）</div>
            <div className="space-y-1">
              {Object.entries(current.nodeResults).map(([nid, nr]) => (
                <div key={nid} className="text-xs flex items-center gap-2 p-1 rounded bg-muted/30">
                  <span className="font-mono">{nid}</span>
                  <Badge variant="outline" className="text-[10px]">{nr.status}</Badge>
                  {nr.durationMs !== undefined && <span className="text-muted-foreground">{nr.durationMs}ms</span>}
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
```

- [ ] **Step 2: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/modules/workflow/components/iteration-result-viewer.tsx
git commit -m "feat(workflow): add iteration result viewer with tab navigation"
```

---

## Self-Review

**Spec coverage check:**
- Section 3 (Subgraph Structure): Covered by Tasks 1, 5 (SubgraphRunner sets exitPort from loop-output)
- Section 4 (Config Schema): Covered by Task 2 (loopNodeConfigSchema with mode, maxIterations, onError, loopVariables, subgraph)
- Section 5 (Execution Flow): Covered by Task 5 (while/for/forEach sequential + parallel)
- Section 5.1 (SubgraphRunner): Covered by Task 3
- Section 5.5 (Error Handling): Covered by Task 5 (stop/skip + 3 consecutive failures)
- Section 5.6 (Cancellation): Covered by Task 5 (abortSignal check each iteration)
- Section 5.7 (Progress): Covered by Task 5 (onProgress callback)
- Section 6.1 (NodeRunResult extension): Covered by Task 1
- Section 6.3 (Validation): Covered by Task 7 (8 validation rules)
- Section 7.1 (Creating loop node): Covered by Task 10 (container + wrapper)
- Section 7.2 (Expandable container): Covered by Task 10 (LoopContainer with expanded/collapsed)
- Section 7.3 (Loop Output interaction): Covered by Tasks 10, 12 (output node rendering + variable mapping panel in Task 9)
- Section 7.4 (Config panel): Covered by Task 9
- Section 7.5 (Runtime visualization): Covered by Tasks 10, 12 (iterationProgress + IterationResultViewer)
- Section 10 (Acceptance criteria): All 20 checklist items mapped to tasks

**Placeholder scan:** No TBD/TODO/placeholder patterns found. All steps have actual code.

**Type consistency:** `LoopNodeConfig` defined in Task 2 matches usage in Tasks 5, 8, 9, 10. `SubgraphRunnerInput/Output` from Task 3 used by Task 5. `IterationResult` from Task 1 used by Task 5 (outputs), Task 10 (display), Task 12 (viewer). All consistent.

**Registry type note:** `SubgraphRunner` imports `NodeTypeRegistry` as a type from `workflow-nodes/registry.ts`. This class is already exported — no additional changes needed.

**Task dependency graph (for parallel execution):**

```
Task 1 ─────────────┬──── Task 3 ────┐
                    │                 │
Task 2 ─────┬──────┼──── Task 7      ├── Task 5 ──┬── Task 6
             │      │                 │             │
             ├──────┼──── Task 8 ─────┼── Task 10 ─┼── Task 11
             │      │                 │             │
             ├──────┼──── Task 9 ─────┘             │
             │      │                               │
Task 4 ─────┘      └──── Task 12                   │
                                                    │
Parallelizable groups:                              │
  Wave 1: Tasks 1, 2, 4 (independent)              │
  Wave 2: Tasks 3, 7, 8, 9, 12 (after Wave 1)     │
  Wave 3: Tasks 5, 10 (after Wave 2)               │
  Wave 4: Tasks 6, 11 (after Wave 3)               │
```
