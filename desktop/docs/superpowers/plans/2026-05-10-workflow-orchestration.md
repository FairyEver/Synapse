# Workflow Orchestration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add workflow orchestration to Synapse — users build multi-step Prompt chains on a visual canvas, configure Switch nodes for conditional branching, and execute them locally against any configured Agent.

**Architecture:** Electron main-process `WorkflowEngine` executes a DAG of nodes; each node type is a self-contained plugin under `desktop/workflow-nodes/`. The engine pushes `WorkflowEvent`s through the EventBus to the renderer, which visualises execution on a `@xyflow/react` canvas opened in a dedicated BrowserWindow. Workflow definitions are stored in the Git content-repo (full-snapshot model); run history is stored locally under `<userData>/workflow-runs/`.

**Tech Stack:** TypeScript · Electron · React · @xyflow/react · Zod · p-queue · shadcn/ui + Radix + Tailwind · Vitest

---

## File Map

### `desktop/workflow-nodes/` (cross-process shared)
- `types.ts` — NodeManifest, NodeExecutor, NodeExecutionInput/Result, WorkflowRuntimeContext, AgentSendDeps
- `registry.ts` — NodeTypeRegistry (register/getManifest/getExecutor/listTypes)
- `schemas/variable-binding.ts` — VariableBinding + VariableSource Zod schemas (with regex)
- `prompt/{manifest,schema,executor.main,card,panel,index}.ts(x)`
- `switch/{manifest,schema,executor.main,card,panel,index}.ts(x)`

### `desktop/electron/services/workflow/`
- `variable-resolver.ts` — resolves `{{$name}}` bindings at runtime
- `workflow-validator.ts` — DAG cycle check, variable path-reachability, config schema validation
- `workflow-service.ts` — CRUD + Git full-snapshot version management
- `run-snapshot-service.ts` — local run history (max 20 per workflow)
- `workflow-engine.ts` — DAG executor, WorkflowEvent emitter, AbortController management
- `window-manager.ts` — editor BrowserWindow lifecycle

### `desktop/electron/modules/workflow/ipc.ts` — IpcModule (13 channels)

### Modified files
| File | Change |
|---|---|
| `desktop/electron/runtime/event-bus/types.ts` | Add `"workflow"` to EventDomain |
| `desktop/electron/bootstrap/descriptors.ts` | Add 5 workflow service descriptors |
| `desktop/electron/bootstrap/registry.ts` | Register workflow descriptors |
| `desktop/electron/bootstrap/ipc-registry.ts` | Register workflowIpcModule |
| `desktop/electron/preload.ts` | Add `workflow` namespace to bridge |
| `desktop/src/types/content.ts` | Add `"workflow"` to SynapseContentType |
| `desktop/src/types/bridge.ts` | Add WorkflowBridge types |
| `desktop/vitest.config.ts` | Add `workflow-nodes` to test include |

### `desktop/src/types/workflow.ts` — all renderer-facing workflow types

### `desktop/src/modules/workflow/`
- `index.tsx`, `components/{workflow-list,workflow-card,run-params-dialog}.tsx`
- `hooks/{use-workflow-list,use-workflow-run,use-workflow-events,use-upstream-nodes}.ts`
- `editor/{editor-app,canvas,toolbar,node-palette,node-wrappers,execution-overlay}.tsx`

---

## Task 1: Data model types + vitest config

**Files:**
- Create: `desktop/workflow-nodes/types.ts`
- Create: `desktop/src/types/workflow.ts`
- Modify: `desktop/vitest.config.ts`

- [x] **Step 1: Add `workflow-nodes` to vitest include**

In `desktop/vitest.config.ts`, add to the `include` array:
```
"workflow-nodes/**/__tests__/**/*.{test,spec}.ts",
```

- [x] **Step 2: Create `desktop/workflow-nodes/types.ts`**

```typescript
import type { ZodType } from "zod"

export interface PortDefinition { id: string; label: string }
export interface ConfigFieldDescriptor {
  name: string
  kind: "text" | "select" | "variable-binding-list" | "branch-list"
  label: string
  optional?: boolean
}

export interface NodeManifest<TConfig = unknown> {
  type: string
  title: string
  icon: string
  color: string
  ports: { inputs: PortDefinition[]; outputs: PortDefinition[] | "dynamic" }
  resolveDynamicPorts?: (config: TConfig) => PortDefinition[]
  cardSummary: (config: TConfig) => { title: string; subtitle: string }
  configFields: readonly ConfigFieldDescriptor[]
  configSchema: ZodType<TConfig>
}

export interface WorkflowRuntimeContext {
  projectId: string
  runId: string
  abortSignal: AbortSignal
}

export interface AgentSendDeps {
  sendToAgent: (input: { agent: string; prompt: string; abortSignal: AbortSignal }) => Promise<{
    status: "success" | "failed"
    response: string
    error?: string
    durationMs: number
  }>
}

export interface NodeExecutionInput<TConfig> {
  config: TConfig
  resolvedVariables: Record<string, string>
  context: WorkflowRuntimeContext
  agentDeps: AgentSendDeps
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
```

- [x] **Step 3: Create `desktop/src/types/workflow.ts`**

```typescript
export interface WorkflowParam {
  name: string; type: "text" | "number"; default: string | number | null; description?: string
}
export interface WorkflowNode {
  id: string; name: string; type: string; position: { x: number; y: number }; config: Record<string, unknown>
}
export interface WorkflowEdge { id: string; from: string; to: string; branch?: string }
export interface WorkflowDefinition {
  id: string; name: string; description?: string; version: string
  createdAt: number; updatedAt: number
  params: WorkflowParam[]; nodes: WorkflowNode[]; edges: WorkflowEdge[]
}
export interface WorkflowMeta {
  id: string; name: string; description?: string; version: string
  nodeCount: number; createdAt: number; updatedAt: number
}
export interface NodeRunResult {
  nodeId: string
  status: "pending" | "running" | "success" | "failed" | "skipped"
  input: { variables: Record<string, string>; prompt?: string }
  output?: string; outputs?: Record<string, unknown>; activeBranch?: string; error?: string
  startedAt?: number; endedAt?: number; durationMs?: number
}
export interface WorkflowRunResult {
  status: "completed" | "failed" | "cancelled"
  nodeResults: Record<string, NodeRunResult>
  durationMs: number
}
export type WorkflowEvent =
  | { type: "workflow:started"; runId: string }
  | { type: "node:started"; nodeId: string }
  | { type: "node:completed"; nodeId: string; output: unknown }
  | { type: "node:failed"; nodeId: string; error: string }
  | { type: "node:skipped"; nodeId: string }
  | { type: "edge:activated"; from: string; to: string }
  | { type: "workflow:completed"; result: WorkflowRunResult }
  | { type: "workflow:failed"; error: string }
  | { type: "workflow:cancelled" }
export interface ValidationError {
  type: "cycle" | "unreachable_reference" | "invalid_config" | "invalid_switch_edge" | "orphan_edge_branch"
  nodeId?: string; edgeId?: string; message: string
}
export interface ValidationWarning { type: "disconnected_node" | "multiple_start_nodes"; nodeId?: string; message: string }
export interface ValidationResult { valid: boolean; errors: ValidationError[]; warnings: ValidationWarning[] }
export interface WorkflowRunSnapshot {
  runId: string; workflowId: string; version: string; startedAt: number; endedAt?: number
  status: "completed" | "failed" | "cancelled"; params: Record<string, unknown>
  nodeResults: Record<string, NodeRunResult>
}
```

- [x] **Step 4: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0

- [x] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/types.ts desktop/src/types/workflow.ts desktop/vitest.config.ts
git commit -m "feat(workflow): shared types + vitest config"
```

---

## Task 2: VariableBinding Zod schema

**Files:**
- Create: `desktop/workflow-nodes/schemas/variable-binding.ts`
- Create: `desktop/workflow-nodes/schemas/__tests__/variable-binding.test.ts`

- [x] **Step 1: Write failing tests**

```typescript
// desktop/workflow-nodes/schemas/__tests__/variable-binding.test.ts
import { describe, expect, it } from "vitest"
import { variableBindingSchema } from "../variable-binding"

describe("variableBindingSchema", () => {
  it("accepts valid names: letter, underscore prefix", () => {
    expect(variableBindingSchema.safeParse({ name: "myVar", source: { type: "static", value: "x" } }).success).toBe(true)
    expect(variableBindingSchema.safeParse({ name: "_private", source: { type: "static", value: "x" } }).success).toBe(true)
  })
  it("rejects names starting with digit or containing hyphens", () => {
    expect(variableBindingSchema.safeParse({ name: "1bad", source: { type: "static", value: "x" } }).success).toBe(false)
    expect(variableBindingSchema.safeParse({ name: "bad-name", source: { type: "static", value: "x" } }).success).toBe(false)
  })
  it("accepts all source types", () => {
    expect(variableBindingSchema.safeParse({ name: "a", source: { type: "param", param: "p" } }).success).toBe(true)
    expect(variableBindingSchema.safeParse({ name: "a", source: { type: "node_output", node: "n1" } }).success).toBe(true)
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/schemas/__tests__/variable-binding.test.ts`  
Expected: FAIL — module not found

- [x] **Step 3: Implement schema**

```typescript
// desktop/workflow-nodes/schemas/variable-binding.ts
import { z } from "zod"

const VARIABLE_NAME_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

export const variableSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("param"), param: z.string().min(1) }),
  z.object({ type: z.literal("node_output"), node: z.string().min(1) }),
  z.object({ type: z.literal("static"), value: z.string() }),
])

export const variableBindingSchema = z.object({
  name: z.string().regex(VARIABLE_NAME_RE, "Variable name must match /^[a-zA-Z_][a-zA-Z0-9_]*/"),
  source: variableSourceSchema,
})

export type VariableBinding = z.infer<typeof variableBindingSchema>
export type VariableSource = z.infer<typeof variableSourceSchema>
```

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/schemas/__tests__/variable-binding.test.ts`  
Expected: PASS — 3 tests

- [x] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/schemas/
git commit -m "feat(workflow): VariableBinding Zod schema with name/branch regex"
```

---

## Task 3: Node type registry

**Files:**
- Create: `desktop/workflow-nodes/registry.ts`
- Create: `desktop/workflow-nodes/__tests__/registry.test.ts`

- [x] **Step 1: Write failing test**

```typescript
// desktop/workflow-nodes/__tests__/registry.test.ts
import { describe, expect, it } from "vitest"
import { NodeTypeRegistry } from "../registry"
import { z } from "zod"
import type { NodeManifest, NodeExecutor } from "../types"

const stub: NodeManifest<{ t: string }> = {
  type: "stub", title: "Stub", icon: "square", color: "bg-muted",
  ports: { inputs: [{ id: "in", label: "In" }], outputs: [{ id: "out", label: "Out" }] },
  cardSummary: (c) => ({ title: c.t, subtitle: "" }),
  configFields: [],
  configSchema: z.object({ t: z.string() }),
}
const exec: NodeExecutor<{ t: string }> = { execute: async () => ({ status: "success", output: "ok", durationMs: 0 }) }

describe("NodeTypeRegistry", () => {
  it("registers and retrieves manifest and executor", () => {
    const r = new NodeTypeRegistry()
    r.register(stub, exec)
    expect(r.getManifest("stub")).toBe(stub)
    expect(r.getExecutor("stub")).toBe(exec)
    expect(r.listTypes()).toEqual(["stub"])
  })
  it("throws for unknown type", () => {
    expect(() => new NodeTypeRegistry().getManifest("nope")).toThrow("Unknown node type: nope")
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/__tests__/registry.test.ts`  
Expected: FAIL

- [x] **Step 3: Implement registry**

```typescript
// desktop/workflow-nodes/registry.ts
import type { NodeManifest, NodeExecutor } from "./types"

export class NodeTypeRegistry {
  private readonly manifests = new Map<string, NodeManifest>()
  private readonly executors = new Map<string, NodeExecutor>()

  register<T>(manifest: NodeManifest<T>, executor: NodeExecutor<T>): void {
    this.manifests.set(manifest.type, manifest as NodeManifest)
    this.executors.set(manifest.type, executor as NodeExecutor)
  }
  getManifest(type: string): NodeManifest {
    const m = this.manifests.get(type)
    if (!m) throw new Error(`Unknown node type: ${type}`)
    return m
  }
  getExecutor(type: string): NodeExecutor {
    const e = this.executors.get(type)
    if (!e) throw new Error(`Unknown node type: ${type}`)
    return e
  }
  listTypes(): string[] { return [...this.manifests.keys()] }
}

export const nodeTypeRegistry = new NodeTypeRegistry()
```

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/__tests__/registry.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/registry.ts desktop/workflow-nodes/__tests__/registry.test.ts
git commit -m "feat(workflow): NodeTypeRegistry"
```

---

## Task 4: Prompt node

**Files:**
- Create: `desktop/workflow-nodes/prompt/schema.ts`
- Create: `desktop/workflow-nodes/prompt/manifest.ts`
- Create: `desktop/workflow-nodes/prompt/executor.main.ts`
- Create: `desktop/workflow-nodes/prompt/__tests__/executor.test.ts`
- Create: `desktop/workflow-nodes/prompt/index.ts`

- [x] **Step 1: Write executor tests**

```typescript
// desktop/workflow-nodes/prompt/__tests__/executor.test.ts
import { describe, expect, it, vi } from "vitest"
import { promptNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const deps = (response: string) => ({
  sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response, durationMs: 5 }),
})

describe("promptNodeExecutor", () => {
  it("interpolates {{$name}} in prompt before sending", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "ok", durationMs: 5 })
    await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "Hello {{$name}}" },
      resolvedVariables: { name: "world" },
      context: ctx, agentDeps: { sendToAgent },
    })
    expect((sendToAgent.mock.calls[0][0] as { prompt: string }).prompt).toBe("Hello world")
  })
  it("returns success with agent response as output", async () => {
    const r = await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx, agentDeps: deps("answer"),
    })
    expect(r.status).toBe("success")
    expect(r.output).toBe("answer")
  })
  it("returns failed when agent fails", async () => {
    const r = await promptNodeExecutor.execute({
      config: { agent: "claude-code", variables: [], prompt: "test" },
      resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "failed" as const, response: "", error: "timeout", durationMs: 100 }) },
    })
    expect(r.status).toBe("failed")
    expect(r.error).toBe("timeout")
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/prompt/__tests__/executor.test.ts`  
Expected: FAIL

- [x] **Step 3: Create `prompt/schema.ts`**

```typescript
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const promptNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
})
export type PromptNodeConfig = z.infer<typeof promptNodeConfigSchema>
```

- [x] **Step 4: Create `prompt/executor.main.ts`**

```typescript
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { PromptNodeConfig } from "./schema"

function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, n) => vars[n] ?? `{{$${n}}}`)
}

export const promptNodeExecutor: NodeExecutor<PromptNodeConfig> = {
  async execute(input: NodeExecutionInput<PromptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const prompt = interpolate(input.config.prompt, input.resolvedVariables)
    const result = await input.agentDeps.sendToAgent({ agent: input.config.agent, prompt, abortSignal: input.context.abortSignal })
    const durationMs = Date.now() - start
    if (result.status === "failed") return { status: "failed", output: "", error: result.error, durationMs }
    return { status: "success", output: result.response, durationMs }
  },
}
```

- [x] **Step 5: Create `prompt/manifest.ts`**

```typescript
import type { NodeManifest } from "../types"
import type { PromptNodeConfig } from "./schema"
import { promptNodeConfigSchema } from "./schema"

export const promptNodeManifest: NodeManifest<PromptNodeConfig> = {
  type: "prompt", title: "Prompt", icon: "MessageSquare", color: "bg-blue-500/10",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (c) => ({ title: c.agent || "未选择 Agent", subtitle: c.prompt.slice(0, 60) || "无 Prompt" }),
  configFields: [
    { name: "agent", kind: "select", label: "Agent" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "Prompt 模板" },
  ],
  configSchema: promptNodeConfigSchema,
}
```

- [x] **Step 6: Create `prompt/index.ts`**

```typescript
export { promptNodeManifest } from "./manifest"
export { promptNodeExecutor } from "./executor.main"
export { promptNodeConfigSchema } from "./schema"
export type { PromptNodeConfig } from "./schema"
```

- [x] **Step 7: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/prompt/__tests__/executor.test.ts`  
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add desktop/workflow-nodes/prompt/
git commit -m "feat(workflow): prompt node (schema, manifest, executor)"
```

---

## Task 5: Switch node

**Files:**
- Create: `desktop/workflow-nodes/switch/schema.ts`
- Create: `desktop/workflow-nodes/switch/manifest.ts`
- Create: `desktop/workflow-nodes/switch/executor.main.ts`
- Create: `desktop/workflow-nodes/switch/__tests__/executor.test.ts`
- Create: `desktop/workflow-nodes/switch/index.ts`

- [x] **Step 1: Write executor tests**

```typescript
// desktop/workflow-nodes/switch/__tests__/executor.test.ts
import { describe, expect, it, vi } from "vitest"
import { switchNodeExecutor } from "../executor.main"

const ctx = { projectId: "p1", runId: "r1", abortSignal: new AbortController().signal }
const config = {
  agent: "claude-code", variables: [], prompt: "Which?",
  branches: [{ id: "yes", label: "Yes" }, { id: "no", label: "No" }],
}

describe("switchNodeExecutor", () => {
  it("sets activeBranch when response matches branch id (trims + lowercases)", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "  YES  ", durationMs: 5 }) },
    })
    expect(r.activeBranch).toBe("yes")
  })
  it("uses defaultBranch on mismatch if configured", async () => {
    const r = await switchNodeExecutor.execute({
      config: { ...config, defaultBranch: "no" }, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("success"); expect(r.activeBranch).toBe("no")
  })
  it("returns failed on mismatch with no defaultBranch", async () => {
    const r = await switchNodeExecutor.execute({
      config, resolvedVariables: {}, context: ctx,
      agentDeps: { sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "maybe", durationMs: 5 }) },
    })
    expect(r.status).toBe("failed"); expect(r.error).toContain("maybe")
  })
  it("appends branch list constraint to prompt", async () => {
    const sendToAgent = vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 })
    await switchNodeExecutor.execute({ config, resolvedVariables: {}, context: ctx, agentDeps: { sendToAgent } })
    const sent = (sendToAgent.mock.calls[0][0] as { prompt: string }).prompt
    expect(sent).toContain("- yes"); expect(sent).toContain("- no")
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/switch/__tests__/executor.test.ts`  
Expected: FAIL

- [x] **Step 3: Create `switch/schema.ts`**

```typescript
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

const BRANCH_ID_RE = /^[a-z][a-z0-9_]*$/

export const switchBranchSchema = z.object({
  id: z.string().regex(BRANCH_ID_RE, "Branch id must match /^[a-z][a-z0-9_]*/"),
  label: z.string().min(1),
})
export const switchNodeConfigSchema = z.object({
  agent: z.string().min(1),
  variables: z.array(variableBindingSchema),
  prompt: z.string(),
  branches: z.array(switchBranchSchema).min(1),
  defaultBranch: z.string().optional(),
})
export type SwitchNodeConfig = z.infer<typeof switchNodeConfigSchema>
export type SwitchBranch = z.infer<typeof switchBranchSchema>
```

- [x] **Step 4: Create `switch/executor.main.ts`**

```typescript
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { SwitchNodeConfig } from "./schema"

function interpolate(t: string, v: Record<string, string>): string {
  return t.replace(/\{\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, n) => v[n] ?? `{{$${n}}}`)
}

export const switchNodeExecutor: NodeExecutor<SwitchNodeConfig> = {
  async execute(input: NodeExecutionInput<SwitchNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, agentDeps, context } = input
    const ids = config.branches.map((b) => b.id)
    const basePrompt = interpolate(config.prompt, resolvedVariables)
    const prompt = `${basePrompt}\n\n---\n你必须只回复以下选项之一（不要包含任何其他文字）：\n${ids.map((id) => `- ${id}`).join("\n")}`

    const agentResult = await agentDeps.sendToAgent({ agent: config.agent, prompt, abortSignal: context.abortSignal })
    const durationMs = Date.now() - start
    if (agentResult.status === "failed") return { status: "failed", output: "", error: agentResult.error, durationMs }

    const raw = agentResult.response.trim().toLowerCase()
    const matched = ids.find((id) => id === raw)
    if (matched) return { status: "success", output: raw, activeBranch: matched, durationMs }
    if (config.defaultBranch) return { status: "success", output: config.defaultBranch, activeBranch: config.defaultBranch, durationMs }
    return {
      status: "failed", output: "", durationMs,
      error: `Agent 响应 "${agentResult.response.trim()}" 不匹配任何分支 [${ids.join(", ")}]`,
    }
  },
}
```

- [x] **Step 5: Create `switch/manifest.ts`**

```typescript
import type { NodeManifest } from "../types"
import type { SwitchNodeConfig } from "./schema"
import { switchNodeConfigSchema } from "./schema"

export const switchNodeManifest: NodeManifest<SwitchNodeConfig> = {
  type: "switch", title: "Switch", icon: "GitBranch", color: "bg-amber-500/10",
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: "dynamic" },
  resolveDynamicPorts: (c) => c.branches.map((b) => ({ id: b.id, label: b.label })),
  cardSummary: (c) => ({ title: c.agent || "未选择 Agent", subtitle: `${c.branches.length} 个分支` }),
  configFields: [
    { name: "agent", kind: "select", label: "Agent" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "prompt", kind: "text", label: "判断 Prompt" },
    { name: "branches", kind: "branch-list", label: "分支" },
  ],
  configSchema: switchNodeConfigSchema,
}
```

- [x] **Step 6: Create `switch/index.ts`**

```typescript
export { switchNodeManifest } from "./manifest"
export { switchNodeExecutor } from "./executor.main"
export { switchNodeConfigSchema } from "./schema"
export type { SwitchNodeConfig, SwitchBranch } from "./schema"
```

- [x] **Step 7: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- workflow-nodes/switch/__tests__/executor.test.ts`  
Expected: PASS

- [x] **Step 8: Commit**

```bash
git add desktop/workflow-nodes/switch/
git commit -m "feat(workflow): switch node (schema, manifest, executor + branch regex)"
```

---

## Task 6: Variable resolver

**Files:**
- Create: `desktop/electron/services/workflow/variable-resolver.ts`
- Create: `desktop/electron/services/__tests__/workflow-variable-resolver.test.ts`

- [x] **Step 1: Write tests**

```typescript
// desktop/electron/services/__tests__/workflow-variable-resolver.test.ts
import { describe, expect, it } from "vitest"
import { resolveVariables, interpolatePrompt } from "../workflow/variable-resolver"
import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"

describe("resolveVariables", () => {
  it("resolves param source", () => {
    const b: VariableBinding[] = [{ name: "t", source: { type: "param", param: "topic" } }]
    expect(resolveVariables(b, { topic: "TS" }, {})).toEqual({ t: "TS" })
  })
  it("resolves node_output source", () => {
    const b: VariableBinding[] = [{ name: "r", source: { type: "node_output", node: "n1" } }]
    expect(resolveVariables(b, {}, { n1: "output" })).toEqual({ r: "output" })
  })
  it("throws when node output missing (skipped branch)", () => {
    const b: VariableBinding[] = [{ name: "x", source: { type: "node_output", node: "missing" } }]
    expect(() => resolveVariables(b, {}, {})).toThrow("missing")
  })
  it("resolves static source", () => {
    const b: VariableBinding[] = [{ name: "g", source: { type: "static", value: "Hello" } }]
    expect(resolveVariables(b, {}, {})).toEqual({ g: "Hello" })
  })
})

describe("interpolatePrompt", () => {
  it("replaces {{$name}} tokens", () => {
    expect(interpolatePrompt("Hello {{$name}}", { name: "world" })).toBe("Hello world")
  })
  it("leaves unresolved tokens unchanged", () => {
    expect(interpolatePrompt("{{$missing}}", {})).toBe("{{$missing}}")
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-variable-resolver.test.ts`  
Expected: FAIL

- [x] **Step 3: Implement**

```typescript
// desktop/electron/services/workflow/variable-resolver.ts
import type { VariableBinding } from "../../../workflow-nodes/schemas/variable-binding"

export function resolveVariables(
  bindings: VariableBinding[],
  paramValues: Record<string, unknown>,
  nodeOutputs: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const { name, source } of bindings) {
    if (source.type === "param") {
      result[name] = String(paramValues[source.param] ?? "")
    } else if (source.type === "node_output") {
      if (!(source.node in nodeOutputs)) {
        throw new Error(`变量 $${name} 引用的节点 ${source.node} 在本次运行中未执行（被分支跳过）`)
      }
      result[name] = nodeOutputs[source.node]
    } else {
      result[name] = source.value
    }
  }
  return result
}

export function interpolatePrompt(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\$([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g, (_, n) => vars[n] ?? `{{$${n}}}`)
}
```

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-variable-resolver.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/variable-resolver.ts desktop/electron/services/__tests__/workflow-variable-resolver.test.ts
git commit -m "feat(workflow): variable resolver"
```

---

## Task 7: Workflow validator

**Files:**
- Create: `desktop/electron/services/workflow/workflow-validator.ts`
- Create: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [x] **Step 1: Write tests**

```typescript
// desktop/electron/services/__tests__/workflow-validator.test.ts
import { describe, expect, it } from "vitest"
import { validateWorkflow } from "../workflow/workflow-validator"
import type { WorkflowDefinition } from "../../../src/types/workflow"

const nodeA = { id: "a", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "hi" } }
const nodeB = { id: "b", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { agent: "claude-code", variables: [], prompt: "bye" } }
const base: WorkflowDefinition = { id: "wf", name: "WF", version: "v1", createdAt: 0, updatedAt: 0, params: [], nodes: [nodeA, nodeB], edges: [{ id: "e1", from: "a", to: "b" }] }

describe("validateWorkflow", () => {
  it("returns valid for a clean two-node DAG", () => {
    const r = validateWorkflow(base)
    expect(r.valid).toBe(true); expect(r.errors).toHaveLength(0)
  })
  it("detects a cycle", () => {
    const r = validateWorkflow({ ...base, edges: [{ id: "e1", from: "a", to: "b" }, { id: "e2", from: "b", to: "a" }] })
    expect(r.valid).toBe(false); expect(r.errors.some((e) => e.type === "cycle")).toBe(true)
  })
  it("detects unreachable variable reference", () => {
    const nodeC = { id: "c", name: "C", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "x", variables: [{ name: "x", source: { type: "node_output", node: "a" } }], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, nodeC], edges: [{ id: "e1", from: "b", to: "c" }] })
    expect(r.errors.some((e) => e.type === "unreachable_reference")).toBe(true)
  })
  it("warns about disconnected node", () => {
    const iso = { id: "iso", name: "Iso", type: "prompt", position: { x: 600, y: 0 }, config: { agent: "x", variables: [], prompt: "" } }
    const r = validateWorkflow({ ...base, nodes: [nodeA, nodeB, iso] })
    expect(r.warnings.some((w) => w.type === "disconnected_node")).toBe(true)
  })
  it("errors on switch edge referencing non-existent branch", () => {
    const sw = { id: "sw", name: "S", type: "switch", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }] } }
    const r = validateWorkflow({ ...base, nodes: [sw, nodeB], edges: [{ id: "e1", from: "sw", to: "b", branch: "nope" }] })
    expect(r.errors.some((e) => e.type === "invalid_switch_edge")).toBe(true)
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-validator.test.ts`  
Expected: FAIL

- [x] **Step 3: Implement validator**

```typescript
// desktop/electron/services/workflow/workflow-validator.ts
import type { WorkflowDefinition, ValidationResult, ValidationError, ValidationWarning } from "../../../src/types/workflow"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"

function buildReverseAdj(def: WorkflowDefinition): Map<string, string[]> {
  const r = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) r.get(e.to)?.push(e.from)
  return r
}

function topoSort(def: WorkflowDefinition): { order: string[]; hasCycle: boolean } {
  const inDeg = new Map(def.nodes.map((n) => [n.id, 0]))
  const adj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
  for (const e of def.edges) { adj.get(e.from)?.push(e.to); inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1) }
  const queue = def.nodes.filter((n) => inDeg.get(n.id) === 0).map((n) => n.id)
  const order: string[] = []
  while (queue.length) {
    const id = queue.shift()!; order.push(id)
    for (const next of adj.get(id) ?? []) { const d = (inDeg.get(next) ?? 0) - 1; inDeg.set(next, d); if (d === 0) queue.push(next) }
  }
  return { order, hasCycle: order.length !== def.nodes.length }
}

function ancestors(nodeId: string, def: WorkflowDefinition): Set<string> {
  const rev = buildReverseAdj(def)
  const visited = new Set<string>(); const stack = [nodeId]
  while (stack.length) { for (const p of rev.get(stack.pop()!) ?? []) { if (!visited.has(p)) { visited.add(p); stack.push(p) } } }
  return visited
}

export function validateWorkflow(def: WorkflowDefinition): ValidationResult {
  const errors: ValidationError[] = []; const warnings: ValidationWarning[] = []
  const { hasCycle } = topoSort(def)
  if (hasCycle) errors.push({ type: "cycle", message: "工作流包含循环依赖" })

  const byId = new Map(def.nodes.map((n) => [n.id, n]))
  if (def.nodes.filter((n) => !def.edges.some((e) => e.to === n.id)).length > 1)
    warnings.push({ type: "multiple_start_nodes", message: "存在多个起始节点" })

  for (const node of def.nodes) {
    if (!def.edges.some((e) => e.to === node.id || e.from === node.id) && def.nodes.length > 1)
      warnings.push({ type: "disconnected_node", nodeId: node.id, message: `节点 "${node.name}" 未连接` })

    try {
      const manifest = nodeTypeRegistry.getManifest(node.type)
      const parsed = manifest.configSchema.safeParse(node.config)
      if (!parsed.success) errors.push({ type: "invalid_config", nodeId: node.id, message: parsed.error.message })
    } catch { /* unknown type — skip */ }

    if (!hasCycle) {
      const anc = ancestors(node.id, def)
      const vars = (node.config as Record<string, unknown>)["variables"]
      for (const v of (Array.isArray(vars) ? vars : []) as Array<Record<string, unknown>>) {
        const src = v["source"] as Record<string, unknown> | undefined
        if (src?.["type"] === "node_output" && !anc.has(src["node"] as string)) {
          errors.push({ type: "unreachable_reference", nodeId: node.id, message: `节点 "${node.name}" 引用了不可达上游节点 "${byId.get(src["node"] as string)?.name ?? src["node"]}"` })
        }
      }
    }
  }

  for (const edge of def.edges) {
    const from = byId.get(edge.from)
    if (!from) continue
    const branches = ((from.config as Record<string, unknown>)["branches"] as Array<{ id: string }> | undefined) ?? []
    if (from.type === "switch") {
      if (edge.branch !== undefined && !branches.some((b) => b.id === edge.branch))
        errors.push({ type: "invalid_switch_edge", edgeId: edge.id, message: `edge branch "${edge.branch}" 不在分支列表中` })
    } else if (edge.branch !== undefined) {
      errors.push({ type: "orphan_edge_branch", edgeId: edge.id, message: `非 Switch 节点出边不应设置 branch` })
    }
  }

  return { valid: errors.length === 0, errors, warnings }
}
```

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-validator.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): DAG validator (cycle, reachability, switch edges)"
```

---

## Task 8: Workflow service (CRUD + Git storage)

**Files:**
- Create: `desktop/electron/services/workflow/workflow-service.ts`
- Create: `desktop/electron/services/__tests__/workflow-service.test.ts`

- [x] **Step 1: Write tests**

```typescript
// desktop/electron/services/__tests__/workflow-service.test.ts
import { randomUUID } from "node:crypto"
import { mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({ app: { getPath: () => "/tmp" } }))

import { WorkflowService } from "../workflow/workflow-service"
import type { WorkflowDefinition } from "../../../src/types/workflow"

const roots: string[] = []
async function tmpDir() {
  const d = path.join(os.tmpdir(), `wf-svc-${randomUUID()}`)
  await mkdir(d, { recursive: true }); roots.push(d); return d
}
afterEach(() => Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))))

function makeDef(): WorkflowDefinition {
  return { id: randomUUID(), name: "WF", version: "", createdAt: 0, updatedAt: 0, params: [], nodes: [], edges: [] }
}

describe("WorkflowService", () => {
  it("save + list + get roundtrip", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    const r = await svc.save(def)
    expect("versionHash" in r && (r as { versionHash: string }).versionHash).toMatch(/^v_/)
    expect((await svc.list()).some((m) => m.id === def.id)).toBe(true)
    expect((await svc.get(def.id))?.name).toBe("WF")
  })
  it("latest save wins when saved twice", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    await svc.save(def)
    await svc.save({ ...def, name: "Updated" })
    expect((await svc.get(def.id))?.name).toBe("Updated")
  })
  it("delete removes workflow", async () => {
    const svc = new WorkflowService(await tmpDir())
    const def = makeDef()
    await svc.save(def); await svc.delete(def.id)
    expect(await svc.get(def.id)).toBeNull()
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-service.test.ts`  
Expected: FAIL

- [x] **Step 3: Implement**

```typescript
// desktop/electron/services/workflow/workflow-service.ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash } from "node:crypto"
import type { WorkflowDefinition, WorkflowMeta, ValidationError } from "../../../src/types/workflow"
import { validateWorkflow } from "./workflow-validator"

export interface WorkflowSaveResult { versionHash: string }
export interface WorkflowSaveError { errors: ValidationError[] }

export class WorkflowService {
  constructor(private readonly repoPath: string) {}

  private dir(id: string) { return path.join(this.repoPath, "workflows", id) }

  private versionHash(def: WorkflowDefinition): string {
    const ts = Date.now()
    const hash = createHash("sha256").update(JSON.stringify(def)).digest("hex").slice(0, 8)
    return `v_${ts}_${hash}`
  }

  async list(): Promise<WorkflowMeta[]> {
    let ids: string[]
    try { ids = await readdir(path.join(this.repoPath, "workflows")) } catch { return [] }
    const metas: WorkflowMeta[] = []
    for (const id of ids) {
      const def = await this.get(id)
      if (def) metas.push({ id: def.id, name: def.name, description: def.description, version: def.version, nodeCount: def.nodes.length, createdAt: def.createdAt, updatedAt: def.updatedAt })
    }
    return metas
  }

  async get(id: string): Promise<WorkflowDefinition | null> {
    let files: string[]
    try { files = await readdir(this.dir(id)) } catch { return null }
    const versions = files.filter((f) => f.startsWith("v_") && f.endsWith(".json")).sort()
    if (!versions.length) return null
    return JSON.parse(await readFile(path.join(this.dir(id), versions[versions.length - 1]), "utf-8")) as WorkflowDefinition
  }

  async save(def: WorkflowDefinition): Promise<WorkflowSaveResult | WorkflowSaveError> {
    const validation = validateWorkflow(def)
    if (!validation.valid) return { errors: validation.errors }
    const versionHash = this.versionHash(def)
    const versioned: WorkflowDefinition = { ...def, version: versionHash, updatedAt: Date.now() }
    await mkdir(this.dir(def.id), { recursive: true })
    await writeFile(path.join(this.dir(def.id), `${versionHash}.json`), JSON.stringify(versioned, null, 2), "utf-8")
    return { versionHash }
  }

  async delete(id: string): Promise<void> {
    try { await rm(this.dir(id), { recursive: true, force: true }) } catch { /* already gone */ }
  }
}
```

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-service.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-service.ts desktop/electron/services/__tests__/workflow-service.test.ts
git commit -m "feat(workflow): WorkflowService CRUD + Git full-snapshot storage"
```

---

## Task 9: Run snapshot service

**Files:**
- Create: `desktop/electron/services/workflow/run-snapshot-service.ts`

- [x] **Step 1: Implement**

```typescript
// desktop/electron/services/workflow/run-snapshot-service.ts
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import type { WorkflowRunSnapshot } from "../../../src/types/workflow"

const MAX = 20

export class RunSnapshotService {
  constructor(private readonly dataDir: string) {}
  private dir(wfId: string) { return path.join(this.dataDir, "workflow-runs", wfId) }

  async save(s: WorkflowRunSnapshot): Promise<void> {
    const dir = this.dir(s.workflowId)
    await mkdir(dir, { recursive: true })
    await writeFile(path.join(dir, `${s.runId}.json`), JSON.stringify(s, null, 2), "utf-8")
    const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort()
    await Promise.all(files.slice(0, Math.max(0, files.length - MAX)).map((f) => rm(path.join(dir, f), { force: true })))
  }

  async list(workflowId: string): Promise<WorkflowRunSnapshot[]> {
    try {
      const files = (await readdir(this.dir(workflowId))).filter((f) => f.endsWith(".json")).sort().reverse()
      return (await Promise.all(files.map(async (f) => {
        try { return JSON.parse(await readFile(path.join(this.dir(workflowId), f), "utf-8")) as WorkflowRunSnapshot }
        catch { return null }
      }))).filter(Boolean) as WorkflowRunSnapshot[]
    } catch { return [] }
  }

  async get(runId: string, workflowId: string): Promise<WorkflowRunSnapshot | null> {
    try { return JSON.parse(await readFile(path.join(this.dir(workflowId), `${runId}.json`), "utf-8")) as WorkflowRunSnapshot }
    catch { return null }
  }
}
```

- [x] **Step 2: Commit**

```bash
git add desktop/electron/services/workflow/run-snapshot-service.ts
git commit -m "feat(workflow): RunSnapshotService (local run history, max 20)"
```

---

## Task 10: Workflow engine

**Files:**
- Create: `desktop/electron/services/workflow/workflow-engine.ts`
- Create: `desktop/electron/services/__tests__/workflow-engine.test.ts`

- [x] **Step 1: Write tests**

```typescript
// desktop/electron/services/__tests__/workflow-engine.test.ts
import { describe, expect, it, vi } from "vitest"
import { WorkflowEngine } from "../workflow/workflow-engine"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { promptNodeManifest, promptNodeExecutor } from "../../../workflow-nodes/prompt"
import { switchNodeManifest, switchNodeExecutor } from "../../../workflow-nodes/switch"
import type { WorkflowDefinition } from "../../../src/types/workflow"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)

const agent = vi.fn().mockResolvedValue({ status: "success" as const, response: "done", durationMs: 5 })

const linear: WorkflowDefinition = {
  id: "wf1", name: "L", version: "v1", createdAt: 0, updatedAt: 0, params: [],
  nodes: [
    { id: "n1", name: "A", type: "prompt", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "p1" } },
    { id: "n2", name: "B", type: "prompt", position: { x: 200, y: 0 }, config: { agent: "x", variables: [], prompt: "p2" } },
  ],
  edges: [{ id: "e1", from: "n1", to: "n2" }],
}

describe("WorkflowEngine", () => {
  it("runs two nodes in order and completes", async () => {
    const events: string[] = []
    const r = await new WorkflowEngine({ sendToAgent: agent }).run({ definition: linear, params: {}, abortSignal: new AbortController().signal, onEvent: (e) => events.push(e.type) })
    expect(r.status).toBe("completed")
    expect(events).toContain("node:started"); expect(events).toContain("workflow:completed")
  })
  it("emits node:skipped for the inactive switch branch", async () => {
    const switchDef: WorkflowDefinition = {
      id: "wf2", name: "S", version: "v1", createdAt: 0, updatedAt: 0, params: [],
      nodes: [
        { id: "sw", name: "Sw", type: "switch", position: { x: 0, y: 0 }, config: { agent: "x", variables: [], prompt: "?", branches: [{ id: "yes", label: "Y" }, { id: "no", label: "N" }] } },
        { id: "by", name: "Yes", type: "prompt", position: { x: 200, y: -50 }, config: { agent: "x", variables: [], prompt: "y" } },
        { id: "bn", name: "No", type: "prompt", position: { x: 200, y: 50 }, config: { agent: "x", variables: [], prompt: "n" } },
      ],
      edges: [{ id: "e1", from: "sw", to: "by", branch: "yes" }, { id: "e2", from: "sw", to: "bn", branch: "no" }],
    }
    const skipped: string[] = []
    await new WorkflowEngine({ sendToAgent: vi.fn().mockResolvedValue({ status: "success" as const, response: "yes", durationMs: 5 }) })
      .run({ definition: switchDef, params: {}, abortSignal: new AbortController().signal, onEvent: (e) => { if (e.type === "node:skipped") skipped.push(e.nodeId) } })
    expect(skipped).toContain("bn"); expect(skipped).not.toContain("by")
  })
  it("cancels on abort signal", async () => {
    const ac = new AbortController()
    const slow = vi.fn().mockImplementation(() => new Promise<never>((_, r) => setTimeout(() => r(new Error("cancelled")), 500)))
    const runP = new WorkflowEngine({ sendToAgent: slow }).run({ definition: linear, params: {}, abortSignal: ac.signal, onEvent: () => {} })
    setTimeout(() => ac.abort(), 10)
    expect((await runP).status).toBe("cancelled")
  })
})
```

- [x] **Step 2: Run to verify failure**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-engine.test.ts`  
Expected: FAIL

- [x] **Step 3: Implement `workflow-engine.ts`**

```typescript
// desktop/electron/services/workflow/workflow-engine.ts
import PQueue from "p-queue"
import { randomUUID } from "node:crypto"
import type { WorkflowDefinition, WorkflowRunResult, WorkflowEvent, NodeRunResult } from "../../../src/types/workflow"
import type { AgentSendDeps, VariableBinding } from "../../../workflow-nodes/types"
import { nodeTypeRegistry } from "../../../workflow-nodes/registry"
import { resolveVariables } from "./variable-resolver"

// Note: VariableBinding is imported from types but the resolveVariables param type
// uses the Zod inferred type from schemas/variable-binding. Cast is safe since shapes match.

export interface WorkflowRunInput {
  definition: WorkflowDefinition
  params: Record<string, unknown>
  abortSignal: AbortSignal
  onEvent: (event: WorkflowEvent) => void
}

export class WorkflowEngine {
  constructor(private readonly agentDeps: AgentSendDeps) {}

  async run(input: WorkflowRunInput): Promise<WorkflowRunResult> {
    const { definition: def, params, abortSignal, onEvent } = input
    const runId = randomUUID()
    const startMs = Date.now()
    const nodeResults: Record<string, NodeRunResult> = {}
    const nodeOutputs: Record<string, string> = {}

    onEvent({ type: "workflow:started", runId })
    if (abortSignal.aborted) { onEvent({ type: "workflow:cancelled" }); return { status: "cancelled", nodeResults, durationMs: 0 } }

    const inDeg = new Map(def.nodes.map((n) => [n.id, 0]))
    const adj = new Map(def.nodes.map((n) => [n.id, [] as string[]]))
    for (const e of def.edges) { adj.get(e.from)?.push(e.to); inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1) }

    const skipped = new Set<string>()
    let failed = false
    const queue = new PQueue({ concurrency: 1 })

    const advanceFrom = (nodeId: string, activeBranch: string | undefined) => {
      for (const edge of def.edges.filter((e) => e.from === nodeId)) {
        if (edge.branch !== undefined && edge.branch !== activeBranch) skipped.add(edge.to)
        onEvent({ type: "edge:activated", from: edge.from, to: edge.to })
        const deg = (inDeg.get(edge.to) ?? 0) - 1; inDeg.set(edge.to, deg)
        if (deg === 0) scheduleNode(edge.to)
      }
    }

    const scheduleNode = (nodeId: string) => {
      void queue.add(async () => {
        if (abortSignal.aborted || failed) return
        if (skipped.has(nodeId)) {
          onEvent({ type: "node:skipped", nodeId })
          nodeResults[nodeId] = { nodeId, status: "skipped", input: { variables: {} } }
          advanceFrom(nodeId, undefined); return
        }
        const node = def.nodes.find((n) => n.id === nodeId)!
        onEvent({ type: "node:started", nodeId })
        nodeResults[nodeId] = { nodeId, status: "running", input: { variables: {} }, startedAt: Date.now() }
        try {
          const executor = nodeTypeRegistry.getExecutor(node.type)
          const vars = (node.config["variables"] ?? []) as Parameters<typeof resolveVariables>[0]
          const resolvedVariables = resolveVariables(vars, params, nodeOutputs)
          const result = await executor.execute({ config: node.config, resolvedVariables, context: { projectId: "", runId, abortSignal }, agentDeps: this.agentDeps })
          const endedAt = Date.now()
          if (result.status === "failed") {
            failed = true
            nodeResults[nodeId] = { nodeId, status: "failed", input: { variables: resolvedVariables }, error: result.error, startedAt: nodeResults[nodeId].startedAt, endedAt, durationMs: result.durationMs }
            onEvent({ type: "node:failed", nodeId, error: result.error ?? "unknown" })
          } else {
            nodeOutputs[nodeId] = result.output
            nodeResults[nodeId] = { nodeId, status: "success", input: { variables: resolvedVariables }, output: result.output, activeBranch: result.activeBranch, startedAt: nodeResults[nodeId].startedAt, endedAt, durationMs: result.durationMs }
            onEvent({ type: "node:completed", nodeId, output: result.output })
            advanceFrom(nodeId, result.activeBranch)
          }
        } catch (err) {
          failed = true
          nodeResults[nodeId] = { nodeId, status: "failed", input: { variables: {} }, error: String(err) }
          onEvent({ type: "node:failed", nodeId, error: String(err) })
        }
      })
    }

    for (const n of def.nodes.filter((n) => inDeg.get(n.id) === 0)) scheduleNode(n.id)
    await queue.onIdle()

    if (abortSignal.aborted) { onEvent({ type: "workflow:cancelled" }); return { status: "cancelled", nodeResults, durationMs: Date.now() - startMs } }
    if (failed) { const r = { status: "failed" as const, nodeResults, durationMs: Date.now() - startMs }; onEvent({ type: "workflow:failed", error: "节点执行失败" }); return r }
    const result = { status: "completed" as const, nodeResults, durationMs: Date.now() - startMs }
    onEvent({ type: "workflow:completed", result }); return result
  }
}
```

> **Note:** `p-queue` must be available in the desktop package. Check `desktop/package.json` — if absent, run `pnpm --filter @synapse/desktop add p-queue`.

- [x] **Step 4: Run tests to pass**

Run: `pnpm --filter @synapse/desktop run test -- electron/services/__tests__/workflow-engine.test.ts`  
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts desktop/electron/services/__tests__/workflow-engine.test.ts
git commit -m "feat(workflow): WorkflowEngine (DAG, node:skipped, AbortSignal)"
```

---

## Task 11: Window manager

**Files:**
- Create: `desktop/electron/services/workflow/window-manager.ts`

- [x] **Step 1: Implement**

```typescript
// desktop/electron/services/workflow/window-manager.ts
import { BrowserWindow } from "electron"

export class WorkflowWindowManager {
  private readonly windows = new Map<string, BrowserWindow>()

  open(workflowId: string, baseUrl: string): BrowserWindow {
    const existing = this.windows.get(workflowId)
    if (existing && !existing.isDestroyed()) { existing.focus(); return existing }

    const win = new BrowserWindow({
      width: 1200, height: 800, title: "Workflow Editor",
      webPreferences: { preload: require.resolve("../../preload"), contextIsolation: true, sandbox: false },
    })

    const url = `${baseUrl}?window=workflow-editor&workflowId=${encodeURIComponent(workflowId)}`
    void win.loadURL(url)

    win.on("close", (e) => { e.preventDefault(); win.webContents.send("synapse:workflow:editor-close-requested") })
    win.on("closed", () => this.windows.delete(workflowId))
    this.windows.set(workflowId, win)
    return win
  }

  forceClose(workflowId: string): void {
    const win = this.windows.get(workflowId)
    if (win && !win.isDestroyed()) win.destroy()
    this.windows.delete(workflowId)
  }

  getOpenEditorIds(): string[] {
    return [...this.windows.entries()].filter(([, w]) => !w.isDestroyed()).map(([id]) => id)
  }

  checkCanSync(): { canSync: boolean; blockers: string[] } {
    const open = this.getOpenEditorIds()
    return open.length > 0
      ? { canSync: false, blockers: open.map((id) => `Workflow editor open: ${id}`) }
      : { canSync: true, blockers: [] }
  }
}
```

- [x] **Step 2: Commit**

```bash
git add desktop/electron/services/workflow/window-manager.ts
git commit -m "feat(workflow): WorkflowWindowManager"
```


---

## Task 12: IPC module

**Files:**
- Modify: `desktop/electron/runtime/event-bus/types.ts` — add `"workflow"` to EventDomain
- Create: `desktop/electron/modules/workflow/ipc.ts`

- [x] **Step 1: Add "workflow" to EventDomain**

In `desktop/electron/runtime/event-bus/types.ts`, add `| "workflow"` to the `EventDomain` union type (after `"install-status"`).

- [x] **Step 2: Create `desktop/electron/modules/workflow/ipc.ts`**

The module exports `workflowIpcModule: IpcModule` with 13 methods plus a push-event descriptor. Key implementation details:

**`synapse:workflow:run` handler** — creates an `AbortController` per run, stores it in a `Map<runId, AbortController>` resolved from service id `"core.workflow.run-aborts"`, starts the engine fire-and-forget, and emits events through the EventBus. Returns `{ runId }` synchronously before the run completes.

**`synapse:workflow:cancel` handler** — looks up the controller by `runId` in the same map and calls `.abort()`.

```typescript
// desktop/electron/modules/workflow/ipc.ts
import { randomUUID } from "node:crypto"
import { z } from "zod"
import type { IpcModule } from "../../runtime/ipc/types"
import type { WorkflowService } from "../../services/workflow/workflow-service"
import type { WorkflowEngine } from "../../services/workflow/workflow-engine"
import type { RunSnapshotService } from "../../services/workflow/run-snapshot-service"
import type { WorkflowWindowManager } from "../../services/workflow/window-manager"
import type { EventBus } from "../../runtime/event-bus"

const workflowDefinitionSchema = z.object({
  id: z.string(), name: z.string(), description: z.string().optional(),
  version: z.string(), createdAt: z.number(), updatedAt: z.number(),
  params: z.array(z.object({ name: z.string(), type: z.enum(["text", "number"]), default: z.union([z.string(), z.number(), z.null()]), description: z.string().optional() })),
  nodes: z.array(z.object({ id: z.string(), name: z.string(), type: z.string(), position: z.object({ x: z.number(), y: z.number() }), config: z.record(z.string(), z.unknown()) })),
  edges: z.array(z.object({ id: z.string(), from: z.string(), to: z.string(), branch: z.string().optional() })),
})

const validationResultSchema = z.object({
  valid: z.boolean(),
  errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })),
  warnings: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), message: z.string() })),
})

export const workflowIpcModule: IpcModule = {
  id: "workflow",
  methods: {
    list: {
      channel: "synapse:workflow:list", kind: "invoke", request: z.void().optional(),
      response: z.array(z.object({ id: z.string(), name: z.string(), description: z.string().optional(), version: z.string(), nodeCount: z.number(), createdAt: z.number(), updatedAt: z.number() })),
      handler: async (ctx) => ctx.resolve<WorkflowService>("core.workflow").list(),
    },
    get: {
      channel: "synapse:workflow:get", kind: "invoke", request: z.object({ id: z.string() }),
      response: workflowDefinitionSchema.nullable(),
      handler: async (ctx, { id }) => ctx.resolve<WorkflowService>("core.workflow").get(id),
    },
    save: {
      channel: "synapse:workflow:save", kind: "invoke", request: workflowDefinitionSchema,
      response: z.union([z.object({ versionHash: z.string() }), z.object({ errors: z.array(z.object({ type: z.string(), nodeId: z.string().optional(), edgeId: z.string().optional(), message: z.string() })) })]),
      handler: async (ctx, def) => ctx.resolve<WorkflowService>("core.workflow").save(def),
    },
    delete: {
      channel: "synapse:workflow:delete", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
      handler: async (ctx, { id }) => ctx.resolve<WorkflowService>("core.workflow").delete(id),
    },
    validate: {
      channel: "synapse:workflow:validate", kind: "invoke", request: workflowDefinitionSchema, response: validationResultSchema,
      handler: async (_ctx, def) => { const { validateWorkflow } = await import("../../services/workflow/workflow-validator"); return validateWorkflow(def) },
    },
    run: {
      channel: "synapse:workflow:run", kind: "invoke",
      request: z.object({ id: z.string(), params: z.record(z.string(), z.unknown()) }),
      response: z.object({ runId: z.string() }),
      handler: async (ctx, { id, params }) => {
        const svc = ctx.resolve<WorkflowService>("core.workflow")
        const engine = ctx.resolve<WorkflowEngine>("core.workflow.engine")
        const snapshots = ctx.resolve<RunSnapshotService>("core.workflow.snapshots")
        const eventBus = ctx.resolve<EventBus>("core.event-bus")
        const abortMap = ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts")

        const def = await svc.get(id)
        if (!def) throw new Error(`Workflow ${id} not found`)

        const ac = new AbortController()
        const runId = randomUUID()
        abortMap.set(runId, ac)

        void engine.run({
          definition: def, params, abortSignal: ac.signal,
          onEvent: (event) => {
            eventBus.emit({ domain: "workflow", type: event.type, payload: event, timestamp: new Date().toISOString() })
            if (event.type === "workflow:completed" || event.type === "workflow:failed" || event.type === "workflow:cancelled") {
              abortMap.delete(runId)
              const status = event.type === "workflow:completed" ? "completed" : event.type === "workflow:cancelled" ? "cancelled" : "failed"
              const nodeResults = event.type === "workflow:completed" ? event.result.nodeResults : {}
              void snapshots.save({ runId, workflowId: id, version: def.version, startedAt: Date.now(), endedAt: Date.now(), status, params, nodeResults })
            }
          },
        })

        return { runId }
      },
    },
    cancel: {
      channel: "synapse:workflow:cancel", kind: "invoke", request: z.object({ runId: z.string() }), response: z.void(),
      handler: (ctx, { runId }) => { ctx.resolve<Map<string, AbortController>>("core.workflow.run-aborts").get(runId)?.abort() },
    },
    runHistory: {
      channel: "synapse:workflow:run-history", kind: "invoke", request: z.object({ workflowId: z.string() }), response: z.array(z.unknown()),
      handler: async (ctx, { workflowId }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").list(workflowId),
    },
    runSnapshot: {
      channel: "synapse:workflow:run-snapshot", kind: "invoke", request: z.object({ runId: z.string(), workflowId: z.string() }), response: z.unknown().nullable(),
      handler: async (ctx, { runId, workflowId }) => ctx.resolve<RunSnapshotService>("core.workflow.snapshots").get(runId, workflowId),
    },
    openEditor: {
      channel: "synapse:workflow:open-editor", kind: "invoke", request: z.object({ id: z.string() }), response: z.void(),
      handler: (ctx, { id }) => {
        const baseUrl = process.env.VITE_DEV_SERVER_URL ?? "app://-"
        ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").open(id, baseUrl)
      },
    },
    editorState: {
      channel: "synapse:workflow:editor-state", kind: "invoke", request: z.void().optional(),
      response: z.object({ openEditors: z.array(z.string()) }),
      handler: (ctx) => ({ openEditors: ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").getOpenEditorIds() }),
    },
    checkCanSync: {
      channel: "synapse:workflow:check-can-sync", kind: "invoke", request: z.void().optional(),
      response: z.object({ canSync: z.boolean(), blockers: z.array(z.string()) }),
      handler: (ctx) => ctx.resolve<WorkflowWindowManager>("core.workflow.window-manager").checkCanSync(),
    },
  },
  events: {
    event: {
      kind: "event", channel: "synapse:workflow:event",
      payload: z.object({ domain: z.literal("workflow"), type: z.string(), payload: z.unknown(), timestamp: z.string() }),
    },
  },
}
```

- [x] **Step 3: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0

- [x] **Step 4: Commit**

```bash
git add desktop/electron/modules/workflow/ desktop/electron/runtime/event-bus/types.ts
git commit -m "feat(workflow): IPC module (13 channels + AbortController run-map)"
```

---

## Task 13: Bootstrap wiring

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`

- [x] **Step 1: Add imports to `descriptors.ts`**

At the top with the other service imports:

```typescript
import { WorkflowService } from "../services/workflow/workflow-service"
import { WorkflowEngine } from "../services/workflow/workflow-engine"
import { RunSnapshotService } from "../services/workflow/run-snapshot-service"
import { WorkflowWindowManager } from "../services/workflow/window-manager"
```

- [x] **Step 2: Add five descriptors at the bottom of `descriptors.ts`**

```typescript
export const coreWorkflowServiceDescriptor: ServiceDescriptor<WorkflowService> = {
  id: "core.workflow",
  criticality: "degraded",
  dependsOn: ["core.config"],
  async create() {
    const config = await configStore.load()
    const repoPath = config.repositories[0]?.localPath ?? app.getPath("userData")
    return new WorkflowService(repoPath)
  },
}

export const coreWorkflowSnapshotsDescriptor: ServiceDescriptor<RunSnapshotService> = {
  id: "core.workflow.snapshots",
  criticality: "degraded",
  create() { return new RunSnapshotService(app.getPath("userData")) },
}

export const coreWorkflowRunAbortsDescriptor: ServiceDescriptor<Map<string, AbortController>> = {
  id: "core.workflow.run-aborts",
  criticality: "degraded",
  create() { return new Map<string, AbortController>() },
}

export const coreWorkflowEngineDescriptor: ServiceDescriptor<WorkflowEngine> = {
  id: "core.workflow.engine",
  criticality: "degraded",
  dependsOn: ["core.project-containers"],
  create(ctx) {
    // Wire sendToAgent through AgentRuntimeService from the project container.
    // The projectId is resolved per-run from the first configured repository.
    // This bridge is injected here so WorkflowEngine remains pure of Electron deps.
    const registry = ctx.registry
    const sendToAgent: import("../../../workflow-nodes/types").AgentSendDeps["sendToAgent"] = async ({ agent, prompt, abortSignal }) => {
      try {
        const config = await configStore.load()
        const projectId = config.repositories[0]?.uuid ?? ""
        const containers = registry.get<import("../services/project-container-registry").ProjectContainerRegistry>("core.project-containers")
        const container = await containers.open(projectId, { name: "", workspacePath: config.repositories[0]?.localPath ?? "" })
        const agentRuntime = container.get<import("../services/agent-runtime").AgentRuntimeService>("agent-runtime")
        const result = await agentRuntime.sendScheduled({
          projectId, agentType: agent, mode: "default", prompt,
          sessionPolicy: "fresh", timeoutMs: 120_000, abortSignal,
        })
        return { status: result.status === "success" ? "success" : "failed", response: result.summary ?? "", error: result.error, durationMs: result.durationMs }
      } catch (err) {
        return { status: "failed", response: "", error: String(err), durationMs: 0 }
      }
    }
    return new WorkflowEngine({ sendToAgent })
  },
}

export const coreWorkflowWindowManagerDescriptor: ServiceDescriptor<WorkflowWindowManager> = {
  id: "core.workflow.window-manager",
  criticality: "degraded",
  create() { return new WorkflowWindowManager() },
}
```

> **Note on `sendScheduled` signature:** The exact parameter shape depends on the current `AgentRuntimeService` interface. Check `desktop/electron/services/agent-runtime/agent-runtime-service.ts` and adjust field names (`agentType` vs `platform`, `sessionPolicy` vs `sessionMode`, etc.) to match. The intent is to send a prompt on a fresh session and return `{ status, summary, error, durationMs }`.

- [x] **Step 3: Register in `registry.ts`**

Add to imports in `registry.ts`:
```typescript
import {
  // ...existing...
  coreWorkflowServiceDescriptor,
  coreWorkflowSnapshotsDescriptor,
  coreWorkflowRunAbortsDescriptor,
  coreWorkflowEngineDescriptor,
  coreWorkflowWindowManagerDescriptor,
} from "./descriptors"
```

Inside `buildServiceRegistry()`:
```typescript
registry.register(coreWorkflowServiceDescriptor)
registry.register(coreWorkflowSnapshotsDescriptor)
registry.register(coreWorkflowRunAbortsDescriptor)
registry.register(coreWorkflowEngineDescriptor)
registry.register(coreWorkflowWindowManagerDescriptor)
```

- [x] **Step 4: Register IPC module in `ipc-registry.ts`**

Add import and call `registry.register(workflowIpcModule, ctx)` in the registration list (following the pattern of existing modules in that file).

- [x] **Step 5: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0 — fix any `AgentRuntimeService` field name mismatches in the descriptor.

- [x] **Step 6: Commit**

```bash
git add desktop/electron/bootstrap/
git commit -m "feat(workflow): service descriptors + IPC registry wiring"
```

---

## Task 14: Preload bridge + renderer types

**Files:**
- Modify: `desktop/src/types/bridge.ts`
- Modify: `desktop/electron/preload.ts`

- [x] **Step 1: Add workflow types to `bridge.ts`**

Add import near the other type imports:
```typescript
import type { WorkflowDefinition, WorkflowMeta, ValidationResult, WorkflowRunSnapshot, WorkflowEvent } from "./workflow"
```

Add `workflow` field to the `SynapseBridge` interface:
```typescript
  workflow: {
    list: () => Promise<WorkflowMeta[]>
    get: (id: string) => Promise<WorkflowDefinition | null>
    save: (def: WorkflowDefinition) => Promise<{ versionHash: string } | { errors: unknown[] }>
    delete: (id: string) => Promise<void>
    validate: (def: WorkflowDefinition) => Promise<ValidationResult>
    run: (id: string, params: Record<string, unknown>) => Promise<{ runId: string }>
    cancel: (runId: string) => Promise<void>
    runHistory: (workflowId: string) => Promise<WorkflowRunSnapshot[]>
    runSnapshot: (runId: string, workflowId: string) => Promise<WorkflowRunSnapshot | null>
    openEditor: (id: string) => Promise<void>
    editorState: () => Promise<{ openEditors: string[] }>
    checkCanSync: () => Promise<{ canSync: boolean; blockers: string[] }>
    onEvent: (listener: (event: WorkflowEvent) => void) => () => void
  }
```

- [x] **Step 2: Add to `preload.ts`**

Locate the `IPC_CHANNELS` constant and add:
```typescript
workflow: {
  list: "synapse:workflow:list",
  get: "synapse:workflow:get",
  save: "synapse:workflow:save",
  delete: "synapse:workflow:delete",
  validate: "synapse:workflow:validate",
  run: "synapse:workflow:run",
  cancel: "synapse:workflow:cancel",
  runHistory: "synapse:workflow:run-history",
  runSnapshot: "synapse:workflow:run-snapshot",
  openEditor: "synapse:workflow:open-editor",
  editorState: "synapse:workflow:editor-state",
  checkCanSync: "synapse:workflow:check-can-sync",
},
```

Locate the `EVENT_CHANNELS` constant and add:
```typescript
workflow: { event: "synapse:workflow:event" },
```

In the bridge object, add `workflow` namespace following the same `invoke` / `subscribe` helpers used by other namespaces (e.g. `taskScheduler`):
```typescript
  workflow: {
    list: invoke(IPC_CHANNELS.workflow.list),
    get: (id: string) => invoke(IPC_CHANNELS.workflow.get)({ id }),
    save: (def: WorkflowDefinition) => invoke(IPC_CHANNELS.workflow.save)(def),
    delete: (id: string) => invoke(IPC_CHANNELS.workflow.delete)({ id }),
    validate: (def: WorkflowDefinition) => invoke(IPC_CHANNELS.workflow.validate)(def),
    run: (id: string, params: Record<string, unknown>) => invoke(IPC_CHANNELS.workflow.run)({ id, params }),
    cancel: (runId: string) => invoke(IPC_CHANNELS.workflow.cancel)({ runId }),
    runHistory: (workflowId: string) => invoke(IPC_CHANNELS.workflow.runHistory)({ workflowId }),
    runSnapshot: (runId: string, workflowId: string) => invoke(IPC_CHANNELS.workflow.runSnapshot)({ runId, workflowId }),
    openEditor: (id: string) => invoke(IPC_CHANNELS.workflow.openEditor)({ id }),
    editorState: invoke(IPC_CHANNELS.workflow.editorState),
    checkCanSync: invoke(IPC_CHANNELS.workflow.checkCanSync),
    onEvent: (listener: (event: WorkflowEvent) => void) =>
      subscribe(EVENT_CHANNELS.workflow.event, (_event: Electron.IpcRendererEvent, domainEvent: unknown) =>
        listener((domainEvent as { payload: WorkflowEvent }).payload)),
  },
```

Add `import type { WorkflowDefinition, WorkflowEvent } from "../src/types/workflow"` at the top of `preload.ts`.

- [x] **Step 3: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0

- [x] **Step 4: Commit**

```bash
git add desktop/electron/preload.ts desktop/src/types/bridge.ts
git commit -m "feat(workflow): preload bridge + SynapseBridge types"
```

---

## Task 15: Renderer hooks

**Files:**
- Create: `desktop/src/modules/workflow/hooks/use-workflow-list.ts`
- Create: `desktop/src/modules/workflow/hooks/use-workflow-run.ts`
- Create: `desktop/src/modules/workflow/hooks/use-workflow-events.ts`
- Create: `desktop/src/modules/workflow/hooks/use-upstream-nodes.ts`

- [x] **Step 1: Create `use-workflow-list.ts`**

```typescript
import { useCallback, useEffect, useState } from "react"
import type { WorkflowMeta } from "@/types/workflow"

export function useWorkflowList() {
  const [items, setItems] = useState<WorkflowMeta[]>([])
  const [loading, setLoading] = useState(false)
  const refresh = useCallback(async () => {
    setLoading(true)
    try { setItems(await window.synapse.workflow.list()) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  return { items, loading, refresh }
}
```

- [x] **Step 2: Create `use-workflow-run.ts`**

```typescript
import { useCallback, useState } from "react"
import type { NodeRunResult } from "@/types/workflow"

export type RunState = "idle" | "running" | "completed" | "failed" | "cancelled"

export function useWorkflowRun(workflowId: string) {
  const [runId, setRunId] = useState<string | null>(null)
  const [runState, setRunState] = useState<RunState>("idle")
  const [nodeResults, setNodeResults] = useState<Record<string, NodeRunResult>>({})

  const start = useCallback(async (params: Record<string, unknown>) => {
    setRunState("running"); setNodeResults({})
    const { runId: id } = await window.synapse.workflow.run(workflowId, params)
    setRunId(id); return id
  }, [workflowId])

  const cancel = useCallback(async () => { if (runId) await window.synapse.workflow.cancel(runId) }, [runId])

  return { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel }
}
```

- [x] **Step 3: Create `use-workflow-events.ts`**

```typescript
import { useEffect } from "react"
import type { WorkflowEvent, NodeRunResult } from "@/types/workflow"

export function useWorkflowEvents(
  runId: string | null,
  callbacks: {
    onNodeStarted?: (nodeId: string) => void
    onNodeCompleted?: (nodeId: string, output: unknown) => void
    onNodeFailed?: (nodeId: string, error: string) => void
    onNodeSkipped?: (nodeId: string) => void
    onCompleted?: (nodeResults: Record<string, NodeRunResult>) => void
    onFailed?: (error: string) => void
    onCancelled?: () => void
  },
) {
  useEffect(() => {
    if (!runId) return
    return window.synapse.workflow.onEvent((event: WorkflowEvent) => {
      if (event.type === "node:started") callbacks.onNodeStarted?.(event.nodeId)
      else if (event.type === "node:completed") callbacks.onNodeCompleted?.(event.nodeId, event.output)
      else if (event.type === "node:failed") callbacks.onNodeFailed?.(event.nodeId, event.error)
      else if (event.type === "node:skipped") callbacks.onNodeSkipped?.(event.nodeId)
      else if (event.type === "workflow:completed") callbacks.onCompleted?.(event.result.nodeResults)
      else if (event.type === "workflow:failed") callbacks.onFailed?.(event.error)
      else if (event.type === "workflow:cancelled") callbacks.onCancelled?.()
    })
  }, [runId])
}
```

- [x] **Step 4: Create `use-upstream-nodes.ts`**

```typescript
import { useMemo } from "react"
import type { WorkflowDefinition } from "@/types/workflow"

export function useUpstreamNodes(nodeId: string, definition: WorkflowDefinition | null) {
  return useMemo(() => {
    if (!definition) return []
    const rev = new Map(definition.nodes.map((n) => [n.id, [] as string[]]))
    for (const e of definition.edges) rev.get(e.to)?.push(e.from)
    const visited = new Set<string>(); const stack = [nodeId]
    while (stack.length) { for (const p of rev.get(stack.pop()!) ?? []) { if (!visited.has(p)) { visited.add(p); stack.push(p) } } }
    return definition.nodes.filter((n) => visited.has(n.id)).map((n) => ({ id: n.id, name: n.name }))
  }, [nodeId, definition])
}
```

- [x] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/hooks/
git commit -m "feat(workflow): renderer hooks (list, run, events, upstream-nodes)"
```

---

## Task 16: Renderer list view

**Files:**
- Create: `desktop/src/modules/workflow/components/workflow-card.tsx`
- Create: `desktop/src/modules/workflow/components/run-params-dialog.tsx`
- Create: `desktop/src/modules/workflow/components/workflow-list.tsx`
- Create: `desktop/src/modules/workflow/index.tsx`

- [x] **Step 1: Create `workflow-card.tsx`**

```tsx
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { WorkflowMeta } from "@/types/workflow"
import { GitBranch, Play } from "lucide-react"

interface WorkflowCardProps { meta: WorkflowMeta; onOpen: () => void; onRun: () => void }

export function WorkflowCard({ meta, onOpen, onRun }: WorkflowCardProps) {
  return (
    <Card className="cursor-pointer hover:bg-muted/50 transition-colors" onDoubleClick={onOpen}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          {meta.name}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{meta.nodeCount} 个节点</span>
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onRun() }}>
          <Play className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  )
}
```

- [x] **Step 2: Create `run-params-dialog.tsx`**

```tsx
import { useState } from "react"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { WorkflowParam } from "@/types/workflow"

interface RunParamsDialogProps { open: boolean; params: WorkflowParam[]; onConfirm: (values: Record<string, unknown>) => void; onCancel: () => void }

export function RunParamsDialog({ open, params, onConfirm, onCancel }: RunParamsDialogProps) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(params.map((p) => [p.name, String(p.default ?? "")])))
  const handleSubmit = () => {
    const parsed: Record<string, unknown> = {}
    for (const p of params) parsed[p.name] = p.type === "number" ? Number(values[p.name]) : values[p.name]
    onConfirm(parsed)
  }
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader><DialogTitle>设置运行参数</DialogTitle></DialogHeader>
        <div className="grid gap-4 py-4">
          {params.length === 0 && <p className="text-sm text-muted-foreground">此工作流无需参数。</p>}
          {params.map((p) => (
            <div key={p.name} className="grid gap-1.5">
              <Label htmlFor={p.name}>{p.description ?? p.name}</Label>
              <Input id={p.name} type={p.type === "number" ? "number" : "text"} value={values[p.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [p.name]: e.target.value }))} />
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>取消</Button>
          <Button onClick={handleSubmit}>运行</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [x] **Step 3: Create `workflow-list.tsx`**

```tsx
import { useState } from "react"
import { WorkflowCard } from "./workflow-card"
import { RunParamsDialog } from "./run-params-dialog"
import { useWorkflowList } from "../hooks/use-workflow-list"
import type { WorkflowDefinition } from "@/types/workflow"

export function WorkflowList() {
  const { items, loading, refresh } = useWorkflowList()
  const [runTarget, setRunTarget] = useState<WorkflowDefinition | null>(null)

  const handleRun = async (id: string) => { const def = await window.synapse.workflow.get(id); if (def) setRunTarget(def) }

  const handleConfirmRun = async (params: Record<string, unknown>) => {
    if (!runTarget) return
    setRunTarget(null)
    await window.synapse.workflow.run(runTarget.id, params)
    void refresh()
  }

  if (loading) return <p className="text-sm text-muted-foreground p-4">加载中…</p>
  if (items.length === 0) return <p className="text-sm text-muted-foreground p-4">还没有工作流。</p>

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 p-4">
        {items.map((meta) => (
          <WorkflowCard key={meta.id} meta={meta}
            onOpen={() => void window.synapse.workflow.openEditor(meta.id)}
            onRun={() => void handleRun(meta.id)} />
        ))}
      </div>
      <RunParamsDialog open={!!runTarget} params={runTarget?.params ?? []} onConfirm={handleConfirmRun} onCancel={() => setRunTarget(null)} />
    </>
  )
}
```

- [x] **Step 4: Create `index.tsx`**

```tsx
import { Button } from "@/components/ui/button"
import { WorkflowList } from "./components/workflow-list"
import { Plus } from "lucide-react"

export function WorkflowModule() {
  const handleCreate = async () => {
    const id = crypto.randomUUID()
    const now = Date.now()
    await window.synapse.workflow.save({ id, name: "新工作流", version: "", createdAt: now, updatedAt: now, params: [], nodes: [], edges: [] })
    await window.synapse.workflow.openEditor(id)
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold">工作流</h2>
        <Button size="sm" variant="outline" onClick={handleCreate}><Plus className="h-4 w-4 mr-1.5" />新建</Button>
      </div>
      <div className="flex-1 overflow-auto"><WorkflowList /></div>
    </div>
  )
}
```

- [x] **Step 5: Commit**

```bash
git add desktop/src/modules/workflow/components/ desktop/src/modules/workflow/index.tsx
git commit -m "feat(workflow): list view (WorkflowModule, WorkflowCard, RunParamsDialog)"
```

---

## Task 17: Editor app shell

**Files:**
- Create: `desktop/src/modules/workflow/editor/editor-app.tsx`
- Modify: `desktop/src/main.tsx`

- [x] **Step 1: Create `editor-app.tsx`**

Reads `?workflowId=` from `window.location.search`, loads the definition, wires `useWorkflowRun` + `useWorkflowEvents`, and renders `WorkflowToolbar` + `WorkflowCanvas` + `ExecutionOverlay`.

```tsx
import { useEffect, useRef, useState } from "react"
import type { WorkflowDefinition, NodeRunResult } from "@/types/workflow"
import { useWorkflowRun } from "../hooks/use-workflow-run"
import { useWorkflowEvents } from "../hooks/use-workflow-events"
import { WorkflowToolbar } from "./toolbar"
import { WorkflowCanvas } from "./canvas"
import { ExecutionOverlay } from "./execution-overlay"

export function WorkflowEditorApp() {
  const workflowId = new URLSearchParams(window.location.search).get("workflowId") ?? ""
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const definitionRef = useRef(definition)
  definitionRef.current = definition

  useEffect(() => { if (workflowId) void window.synapse.workflow.get(workflowId).then(setDefinition) }, [workflowId])

  const { runId, runState, nodeResults, setRunState, setNodeResults, start, cancel } = useWorkflowRun(workflowId)

  useWorkflowEvents(runId, {
    onNodeStarted: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "running" as const } })),
    onNodeCompleted: (nodeId, output) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "success" as const, output: String(output) } })),
    onNodeFailed: (nodeId, error) => setNodeResults((r) => ({ ...r, [nodeId]: { ...(r[nodeId] ?? { nodeId, input: { variables: {} } }), status: "failed" as const, error } })),
    onNodeSkipped: (nodeId) => setNodeResults((r) => ({ ...r, [nodeId]: { nodeId, input: { variables: {} }, status: "skipped" as const } })),
    onCompleted: (results) => { setRunState("completed"); setNodeResults(results) },
    onFailed: () => setRunState("failed"),
    onCancelled: () => setRunState("cancelled"),
  })

  const handleSave = async (def: WorkflowDefinition) => {
    const result = await window.synapse.workflow.save(def)
    if ("versionHash" in result) setDefinition({ ...def, version: result.versionHash })
    return result
  }

  if (!definition) return <div className="flex items-center justify-center h-screen text-sm text-muted-foreground">加载中…</div>

  return (
    <div className="flex flex-col h-screen">
      <WorkflowToolbar definition={definition} runState={runState} onSave={handleSave} onRun={start} onCancel={cancel} onChange={setDefinition} />
      <div className="flex-1 relative">
        <WorkflowCanvas definition={definition} onChange={setDefinition} />
        <ExecutionOverlay nodeResults={nodeResults} runState={runState} />
      </div>
    </div>
  )
}
```

- [x] **Step 2: Route editor window in `main.tsx`**

The renderer `main.tsx` currently renders `<App />` unconditionally. Add a URL-param branch so the editor window renders a separate root:

```tsx
// At the top of main.tsx, before createRoot():
const urlParams = new URLSearchParams(window.location.search)
const windowType = urlParams.get("window")

// Replace the createRoot render block:
if (windowType === "workflow-editor") {
  const { WorkflowEditorApp } = await import("@/modules/workflow/editor/editor-app")
  createRoot(document.getElementById("root")!).render(<StrictMode><AppErrorBoundary><WorkflowEditorApp /></AppErrorBoundary></StrictMode>)
} else {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      {/* ...existing providers... */}
    </StrictMode>,
  )
}
```

Since `main.tsx` is not async, wrap in a top-level async IIFE or use dynamic `import()` inside the render call. Match the existing pattern in the codebase (check if other window types already do branching in main.tsx).

- [x] **Step 3: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0

- [x] **Step 4: Commit**

```bash
git add desktop/src/modules/workflow/editor/editor-app.tsx desktop/src/main.tsx
git commit -m "feat(workflow): editor app shell + main.tsx window routing"
```

---

## Task 18: Canvas + node wrappers

**Files:**
- Create: `desktop/src/modules/workflow/editor/canvas.tsx`
- Create: `desktop/src/modules/workflow/editor/node-wrappers.tsx`
- Create: `desktop/workflow-nodes/prompt/card.tsx`
- Create: `desktop/workflow-nodes/switch/card.tsx`

> Prerequisite: `@xyflow/react` must be in `desktop/package.json`. If absent, add it: `pnpm --filter @synapse/desktop add @xyflow/react`.

- [x] **Step 1: Create `prompt/card.tsx`** (canvas node card, renderer-side)

```tsx
// desktop/workflow-nodes/prompt/card.tsx
import { MessageSquare } from "lucide-react"
import type { PromptNodeConfig } from "./schema"

export function PromptNodeCard({ config, selected }: { config: PromptNodeConfig; selected?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-2 w-52 shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <MessageSquare className="h-3.5 w-3.5 text-blue-500" />
        <span className="text-xs font-medium text-foreground truncate">{config.agent || "Prompt"}</span>
      </div>
      <p className="text-xs text-muted-foreground truncate">{config.prompt.slice(0, 50) || "无 Prompt"}</p>
    </div>
  )
}
```

- [x] **Step 2: Create `switch/card.tsx`**

```tsx
// desktop/workflow-nodes/switch/card.tsx
import { GitBranch } from "lucide-react"
import type { SwitchNodeConfig } from "./schema"

export function SwitchNodeCard({ config, selected }: { config: SwitchNodeConfig; selected?: boolean }) {
  return (
    <div className={`rounded-lg border bg-card px-3 py-2 w-52 shadow-sm ${selected ? "ring-2 ring-primary" : ""}`}>
      <div className="flex items-center gap-2 mb-1">
        <GitBranch className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs font-medium text-foreground truncate">{config.agent || "Switch"}</span>
      </div>
      <p className="text-xs text-muted-foreground">{config.branches.length} 个分支</p>
    </div>
  )
}
```

- [x] **Step 3: Create `node-wrappers.tsx`** (React Flow node type adapter)

```tsx
// desktop/src/modules/workflow/editor/node-wrappers.tsx
import { Handle, Position, type NodeProps } from "@xyflow/react"
import { PromptNodeCard } from "../../../../workflow-nodes/prompt/card"
import { SwitchNodeCard } from "../../../../workflow-nodes/switch/card"

export function PromptNodeWrapper({ data, selected }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <PromptNodeCard config={data as Parameters<typeof PromptNodeCard>[0]["config"]} selected={selected} />
      <Handle type="source" position={Position.Right} />
    </>
  )
}

export function SwitchNodeWrapper({ data, selected }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <SwitchNodeCard config={data as Parameters<typeof SwitchNodeCard>[0]["config"]} selected={selected} />
      {/* Dynamic output handles rendered per branch */}
      {(data as { branches?: Array<{ id: string; label: string }> }).branches?.map((b, i, arr) => (
        <Handle key={b.id} type="source" position={Position.Right} id={b.id} style={{ top: `${((i + 0.5) / arr.length) * 100}%` }} />
      ))}
    </>
  )
}

export const nodeTypes = {
  prompt: PromptNodeWrapper,
  switch: SwitchNodeWrapper,
}
```

- [x] **Step 4: Create `canvas.tsx`**

```tsx
// desktop/src/modules/workflow/editor/canvas.tsx
import { useCallback } from "react"
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, addEdge, type Connection } from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { nodeTypes } from "./node-wrappers"
import type { WorkflowDefinition, WorkflowNode, WorkflowEdge } from "@/types/workflow"
import { randomUUID } from "@/lib/utils"

function defToFlow(def: WorkflowDefinition) {
  const nodes = def.nodes.map((n) => ({ id: n.id, type: n.type, position: n.position, data: n.config, selected: false }))
  const edges = def.edges.map((e) => ({ id: e.id, source: e.from, target: e.to, sourceHandle: e.branch }))
  return { nodes, edges }
}

interface WorkflowCanvasProps { definition: WorkflowDefinition; onChange: (def: WorkflowDefinition) => void }

export function WorkflowCanvas({ definition, onChange }: WorkflowCanvasProps) {
  const { nodes: initNodes, edges: initEdges } = defToFlow(definition)
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges)

  const onConnect = useCallback((connection: Connection) => {
    setEdges((eds) => {
      const updated = addEdge(connection, eds)
      const wfEdges: WorkflowEdge[] = updated.map((e) => ({ id: e.id, from: e.source, to: e.target, branch: e.sourceHandle ?? undefined }))
      onChange({ ...definition, edges: wfEdges })
      return updated
    })
  }, [definition, onChange, setEdges])

  const onNodeDragStop = useCallback(() => {
    const wfNodes: WorkflowNode[] = nodes.map((n) => ({ id: n.id, name: (n.data as { name?: string }).name ?? n.id, type: n.type ?? "prompt", position: n.position, config: n.data as Record<string, unknown> }))
    onChange({ ...definition, nodes: wfNodes })
  }, [nodes, definition, onChange])

  return (
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
      onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
      onConnect={onConnect} onNodeDragStop={onNodeDragStop}
      fitView>
      <Background />
      <Controls />
    </ReactFlow>
  )
}
```

> **Note on `randomUUID`:** Import from `node:crypto` is not available in renderer. Use `crypto.randomUUID()` (web API, available in modern Electron renderer). Adjust import accordingly.

- [x] **Step 5: Commit**

```bash
git add desktop/workflow-nodes/prompt/card.tsx desktop/workflow-nodes/switch/card.tsx desktop/src/modules/workflow/editor/
git commit -m "feat(workflow): canvas + React Flow node wrappers"
```

---

## Task 19: Toolbar, node palette, execution overlay

**Files:**
- Create: `desktop/src/modules/workflow/editor/toolbar.tsx`
- Create: `desktop/src/modules/workflow/editor/node-palette.tsx`
- Create: `desktop/src/modules/workflow/editor/execution-overlay.tsx`

- [x] **Step 1: Create `toolbar.tsx`**

```tsx
// desktop/src/modules/workflow/editor/toolbar.tsx
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Save, Play, Square } from "lucide-react"
import type { WorkflowDefinition } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"

interface WorkflowToolbarProps {
  definition: WorkflowDefinition
  runState: RunState
  onSave: (def: WorkflowDefinition) => Promise<unknown>
  onRun: (params: Record<string, unknown>) => Promise<string>
  onCancel: () => Promise<void>
  onChange: (def: WorkflowDefinition) => void
}

export function WorkflowToolbar({ definition, runState, onSave, onRun, onCancel, onChange }: WorkflowToolbarProps) {
  const isRunning = runState === "running"
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 bg-background">
      <Input
        className="h-7 w-48 text-sm"
        value={definition.name}
        onChange={(e) => onChange({ ...definition, name: e.target.value })}
      />
      <div className="ml-auto flex items-center gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => void onSave(definition)}><Save className="h-3.5 w-3.5 mr-1" />保存</Button>
        {isRunning
          ? <Button size="sm" variant="destructive" onClick={() => void onCancel()}><Square className="h-3.5 w-3.5 mr-1" />停止</Button>
          : <Button size="sm" onClick={() => void onRun({})}><Play className="h-3.5 w-3.5 mr-1" />运行</Button>
        }
      </div>
    </div>
  )
}
```

- [x] **Step 2: Create `node-palette.tsx`**

```tsx
// desktop/src/modules/workflow/editor/node-palette.tsx
import { nodeTypeRegistry } from "../../../../workflow-nodes/registry"

export function NodePalette() {
  const types = nodeTypeRegistry.listTypes()
  return (
    <div className="w-44 border-r bg-background flex flex-col gap-1 p-2">
      <p className="text-xs font-medium text-muted-foreground px-1 pb-1">节点</p>
      {types.map((type) => {
        const manifest = nodeTypeRegistry.getManifest(type)
        return (
          <div
            key={type}
            draggable
            onDragStart={(e) => e.dataTransfer.setData("application/workflow-node-type", type)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs cursor-grab hover:bg-muted active:cursor-grabbing"
          >
            <span className="text-muted-foreground">{manifest.title}</span>
          </div>
        )
      })}
    </div>
  )
}
```

- [x] **Step 3: Create `execution-overlay.tsx`**

Overlays per-node status badges on the canvas using absolute positioning. Reads `nodeResults` and shows a coloured badge (running/success/failed/skipped) near each node. Implementation uses a `div` overlay with `pointer-events-none` that maps over nodes — since React Flow exposes node positions, the overlay iterates `nodeResults` and positions badges. A simple approach: render a fixed panel listing node statuses rather than true overlay positioning (position overlay is complex without direct access to internal React Flow node DOM refs).

```tsx
// desktop/src/modules/workflow/editor/execution-overlay.tsx
import type { NodeRunResult } from "@/types/workflow"
import type { RunState } from "../hooks/use-workflow-run"
import { Badge } from "@/components/ui/badge"

const STATUS_LABEL: Record<string, string> = { running: "执行中", success: "完成", failed: "失败", skipped: "跳过", pending: "等待" }
const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  running: "default", success: "secondary", failed: "destructive", skipped: "outline", pending: "outline",
}

interface ExecutionOverlayProps { nodeResults: Record<string, NodeRunResult>; runState: RunState }

export function ExecutionOverlay({ nodeResults, runState }: ExecutionOverlayProps) {
  if (runState === "idle") return null
  return (
    <div className="absolute bottom-4 right-4 bg-background/90 border rounded-lg shadow-sm p-3 flex flex-col gap-1.5 max-h-64 overflow-auto pointer-events-none z-10">
      <p className="text-xs font-medium text-muted-foreground mb-1">运行状态</p>
      {Object.values(nodeResults).map((r) => (
        <div key={r.nodeId} className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[r.status] ?? "outline"} className="text-xs">{STATUS_LABEL[r.status] ?? r.status}</Badge>
          <span className="text-xs text-muted-foreground truncate max-w-32">{r.nodeId}</span>
        </div>
      ))}
    </div>
  )
}
```

- [x] **Step 4: Commit**

```bash
git add desktop/src/modules/workflow/editor/toolbar.tsx desktop/src/modules/workflow/editor/node-palette.tsx desktop/src/modules/workflow/editor/execution-overlay.tsx
git commit -m "feat(workflow): toolbar, node palette, execution overlay"
```

---

## Task 20: Main window tab registration

**Files:**
- Identify and modify the file that declares app-shell navigation tabs (typically `desktop/src/App.tsx` or `desktop/src/app-shell/navigation.ts` / `desktop/src/app-shell/tabs.tsx`).

- [x] **Step 1: Find the tab registration file**

Run: `grep -r "taskScheduler\|Scheduler\|tabId\|TabItem" desktop/src/App.tsx desktop/src/app-shell/ --include="*.tsx" --include="*.ts" -l`

Identify which file defines the sidebar tabs or navigation entries.

- [x] **Step 2: Add Workflow tab entry**

Following the exact pattern used for the existing Scheduler/Database tab, add a Workflow entry:

```tsx
{ id: "workflow", label: "工作流", icon: <GitBranch className="h-4 w-4" />, component: <WorkflowModule /> }
```

Import `WorkflowModule` from `@/modules/workflow` and `GitBranch` from `lucide-react`.

- [x] **Step 3: Register prompt + switch node types at app startup**

In `desktop/src/modules/workflow/index.tsx` or a dedicated `workflow-nodes/register.main.ts` called from bootstrap, register both node types into the singleton `nodeTypeRegistry`:

```typescript
// desktop/workflow-nodes/register.main.ts
import { nodeTypeRegistry } from "./registry"
import { promptNodeManifest, promptNodeExecutor } from "./prompt"
import { switchNodeManifest, switchNodeExecutor } from "./switch"

nodeTypeRegistry.register(promptNodeManifest, promptNodeExecutor)
nodeTypeRegistry.register(switchNodeManifest, switchNodeExecutor)
```

Call this file from the workflow service descriptor's `create()` (before constructing `WorkflowEngine`) by adding `import "../../../workflow-nodes/register.main"` at the top of `descriptors.ts`.

- [x] **Step 4: Verify TypeScript**

Run: `pnpm --filter @synapse/desktop run typecheck`  
Expected: exit 0

- [x] **Step 5: Run all workflow tests**

Run: `pnpm --filter @synapse/desktop run test -- --reporter=verbose workflow`  
Expected: all tests PASS

- [x] **Step 6: Run hard-constraint check**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints`  
Expected: exit 0

- [x] **Step 7: Final commit**

```bash
git add desktop/src/ desktop/workflow-nodes/register.main.ts
git commit -m "feat(workflow): main window tab + node type registration"
```

---

## Post-implementation checklist

- [ ] All 20 tasks committed and TypeScript clean
- [ ] All workflow tests pass: `pnpm --filter @synapse/desktop run test -- workflow`
- [ ] Hard constraints pass: `pnpm --filter @synapse/desktop run check:hard-constraints`
- [ ] `WorkflowEvent` union includes `{ type: "node:skipped"; nodeId: string }` ✓ (Task 1)
- [ ] `SwitchBranch.id` Zod regex `/^[a-z][a-z0-9_]*$/` in `switch/schema.ts` ✓ (Task 5)
- [ ] `VariableBinding.name` Zod regex `/^[a-zA-Z_][a-zA-Z0-9_]*$/` in `schemas/variable-binding.ts` ✓ (Task 2)
- [ ] IPC `synapse:workflow:run` creates `AbortController`, stores in `Map<runId, AbortController>` ✓ (Task 12)
- [ ] IPC `synapse:workflow:cancel` finds controller by `runId` and calls `.abort()` ✓ (Task 12)
- [ ] No bare `ipcMain.handle` calls (all IPC goes through `IpcRegistry`) ✓
- [ ] No bare `webContents.send` calls (events go through `EventBus.emit`) ✓

