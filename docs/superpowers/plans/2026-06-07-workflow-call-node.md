# Workflow Call Node Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workflow_call` workflow node that automatically maps parent context into child workflow params and returns the child workflow End output.

**Architecture:** Implement `workflow_call` as a normal workflow node with its own schema, manifest, card, panel, and executor. Parameter construction lives in a focused helper; execution uses a narrow `NodeRuntimeDeps.workflowCall` interface so the node executor does not read storage, touch IPC, or own top-level run lifecycle. `WorkflowEngine` carries a call stack through node contexts to prevent recursion and enforce maximum depth.

**Tech Stack:** Electron main process, React, TypeScript, Zod, Vitest, shadcn/ui + Radix, existing workflow node registry.

---

## File Structure

- Create `desktop/workflow-nodes/workflow-call/params.ts`
  - Builds child workflow params from child `params`, templates, and resolved node variables.
  - Extracts `{{variable}}` references for validation.
- Create `desktop/workflow-nodes/workflow-call/schema.ts`
  - Zod schema for `WorkflowCallNodeConfig`.
- Create `desktop/workflow-nodes/workflow-call/manifest.ts`
  - Node manifest used by main and renderer registries.
- Create `desktop/workflow-nodes/workflow-call/executor.main.ts`
  - Executes the selected child workflow through `runtimeDeps.workflowCall`.
- Create `desktop/workflow-nodes/workflow-call/card.tsx`
  - Compact editor/runner node card.
- Create `desktop/workflow-nodes/workflow-call/panel.tsx`
  - Renderer config panel: workflow selector, variable bindings, parameter templates.
- Create `desktop/workflow-nodes/workflow-call/index.ts`
  - Barrel exports for main-side registration.
- Modify `desktop/workflow-nodes/types.ts`
  - Add workflow call runtime dependency and call stack context.
- Modify `desktop/electron/services/workflow/workflow-engine.ts`
  - Thread call stack through execution context.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Inject child workflow lookup and runner into `NodeRuntimeDeps`.
- Modify `desktop/electron/services/workflow/workflow-validator.ts`
  - Validate `workflow_call` config, direct self-call, template variables, and child param templates.
- Modify `desktop/workflow-nodes/register.main.ts`
  - Register `workflow_call` manifest and executor.
- Modify `desktop/workflow-nodes/register.renderer.ts`
  - Register `workflow_call` manifest.
- Modify `desktop/workflow-nodes/panel-registry.ts`
  - Register `WorkflowCallNodePanel` and pass current workflow ID through panel props.
- Modify `desktop/src/modules/workflow/editor/node-config-panel.tsx`
  - Pass `currentWorkflowId` to node panels.
- Modify `desktop/src/modules/workflow/editor/node-wrappers.tsx`
  - Add editor wrapper.
- Modify `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
  - Add runner wrapper.
- Modify `desktop/src/types/workflow.ts`
  - Add typed child workflow output fields if the implementation needs a stable exported type.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add user-facing release note.

## Task 1: Parameter Template Helper

**Files:**
- Create: `desktop/workflow-nodes/workflow-call/params.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/params.test.ts`

- [ ] **Step 1: Write failing tests for template extraction and param construction**

Create `desktop/workflow-nodes/workflow-call/__tests__/params.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "../../../src/types/workflow"
import {
  buildWorkflowCallParams,
  extractWorkflowCallTemplateVariables,
} from "../params"

function child(params: WorkflowDefinition["params"]): Pick<WorkflowDefinition, "params"> {
  return { params }
}

describe("workflow call params", () => {
  it("extracts unique template variable names", () => {
    expect(extractWorkflowCallTemplateVariables("请总结 {{topic}} 给 {{$audience}}，再引用 {{topic}}")).toEqual([
      "topic",
      "audience",
    ])
  })

  it("renders text and number params from templates", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "topic", type: "text", default: null },
        { name: "limit", type: "number", default: null },
      ]),
      paramTemplates: {
        topic: "请总结：{{source}}",
        limit: "{{max_count}}",
      },
      resolvedVariables: {
        source: "搜索结果",
        max_count: "3",
      },
    })

    expect(result).toEqual({
      params: {
        topic: "请总结：搜索结果",
        limit: 3,
      },
      errors: [],
    })
  })

  it("uses child defaults when template is missing", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([
        { name: "topic", type: "text", default: "默认主题" },
        { name: "limit", type: "number", default: 2 },
      ]),
      paramTemplates: {},
      resolvedVariables: {},
    })

    expect(result.params).toEqual({ topic: "默认主题", limit: 2 })
    expect(result.errors).toEqual([])
  })

  it("reports missing required text params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "topic", type: "text", default: null }]),
      paramTemplates: {},
      resolvedVariables: {},
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「topic」缺少必填值"])
  })

  it("reports invalid number params", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "limit", type: "number", default: null }]),
      paramTemplates: { limit: "{{bad_number}}" },
      resolvedVariables: { bad_number: "three" },
    })

    expect(result.params).toEqual({})
    expect(result.errors).toEqual(["子工作流参数「limit」必须是数字"])
  })

  it("reports template interpolation errors", () => {
    const result = buildWorkflowCallParams({
      childDefinition: child([{ name: "topic", type: "text", default: null }]),
      paramTemplates: { topic: "{{missing}}" },
      resolvedVariables: {},
    })

    expect(result.params).toEqual({})
    expect(result.errors[0]).toContain("子工作流参数「topic」模板变量解析失败")
  })
})
```

- [ ] **Step 2: Run helper tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/params.test.ts
```

Expected: FAIL because `workflow-nodes/workflow-call/params.ts` does not exist.

- [ ] **Step 3: Implement the helper**

Create `desktop/workflow-nodes/workflow-call/params.ts`:

```ts
import type { WorkflowDefinition, WorkflowParam } from "../../src/types/workflow"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"

const TEMPLATE_VARIABLE_RE = /\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu

export interface BuildWorkflowCallParamsInput {
  childDefinition: Pick<WorkflowDefinition, "params">
  paramTemplates: Record<string, string>
  resolvedVariables: Record<string, string>
}

export interface BuildWorkflowCallParamsResult {
  params: Record<string, unknown>
  errors: string[]
}

export function extractWorkflowCallTemplateVariables(template: string): string[] {
  const names = new Set<string>()
  for (const match of template.matchAll(TEMPLATE_VARIABLE_RE)) {
    names.add(match[1])
  }
  return [...names]
}

export function buildWorkflowCallParams(input: BuildWorkflowCallParamsInput): BuildWorkflowCallParamsResult {
  const params: Record<string, unknown> = {}
  const errors: string[] = []

  for (const param of input.childDefinition.params) {
    const template = input.paramTemplates[param.name]
    const hasTemplate = typeof template === "string" && template.length > 0

    if (!hasTemplate) {
      if (paramHasDefault(param)) {
        params[param.name] = param.default
      } else {
        errors.push(`子工作流参数「${param.name}」缺少必填值`)
      }
      continue
    }

    let rendered: string
    try {
      rendered = interpolatePrompt(template, input.resolvedVariables)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      errors.push(`子工作流参数「${param.name}」模板变量解析失败：${message}`)
      continue
    }

    if (param.type === "text") {
      if (rendered.trim().length === 0 && !paramHasDefault(param)) {
        errors.push(`子工作流参数「${param.name}」缺少必填值`)
      } else if (rendered.trim().length === 0 && paramHasDefault(param)) {
        params[param.name] = param.default
      } else {
        params[param.name] = rendered
      }
      continue
    }

    const numberValue = Number(rendered.trim())
    if (!Number.isFinite(numberValue)) {
      errors.push(`子工作流参数「${param.name}」必须是数字`)
      continue
    }
    params[param.name] = numberValue
  }

  return { params, errors }
}

function paramHasDefault(param: WorkflowParam): boolean {
  return param.default !== undefined && param.default !== null
}
```

- [ ] **Step 4: Run helper tests and verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/params.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper**

```bash
git add desktop/workflow-nodes/workflow-call/params.ts desktop/workflow-nodes/workflow-call/__tests__/params.test.ts
git commit -m "feat(workflow): add workflow call param builder"
```

## Task 2: Node Schema, Manifest, Card, and Registration

**Files:**
- Create: `desktop/workflow-nodes/workflow-call/schema.ts`
- Create: `desktop/workflow-nodes/workflow-call/manifest.ts`
- Create: `desktop/workflow-nodes/workflow-call/card.tsx`
- Create: `desktop/workflow-nodes/workflow-call/index.ts`
- Modify: `desktop/workflow-nodes/register.main.ts`
- Modify: `desktop/workflow-nodes/register.renderer.ts`
- Modify: `desktop/src/modules/workflow/editor/node-wrappers.tsx`
- Modify: `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/schema.test.ts`
- Test: `desktop/src/modules/workflow/editor/__tests__/node-palette.test.tsx`

- [ ] **Step 1: Write failing schema tests**

Create `desktop/workflow-nodes/workflow-call/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { workflowCallNodeConfigSchema } from "../schema"
import { workflowCallNodeManifest } from "../manifest"

describe("workflow_call node schema", () => {
  it("accepts workflow id, variables, and param templates", () => {
    const result = workflowCallNodeConfigSchema.safeParse({
      workflowId: "child-1",
      variables: [{ name: "topic", source: { type: "param", param: "topic" } }],
      paramTemplates: { topic: "请总结 {{topic}}" },
    })

    expect(result.success).toBe(true)
  })

  it("rejects missing workflow id", () => {
    const result = workflowCallNodeConfigSchema.safeParse({
      workflowId: "",
      variables: [],
      paramTemplates: {},
    })

    expect(result.success).toBe(false)
  })

  it("declares a single input and single output", () => {
    expect(workflowCallNodeManifest.type).toBe("workflow_call")
    expect(workflowCallNodeManifest.ports).toEqual({
      inputs: [{ id: "in", label: "输入" }],
      outputs: [{ id: "out", label: "输出" }],
    })
  })
})
```

- [ ] **Step 2: Run schema tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/schema.test.ts
```

Expected: FAIL because schema and manifest files do not exist.

- [ ] **Step 3: Create schema, manifest, card, and barrel export**

Create `desktop/workflow-nodes/workflow-call/schema.ts`:

```ts
import { z } from "zod"
import { variableBindingSchema } from "../schemas/variable-binding"

export const workflowCallNodeConfigSchema = z.object({
  workflowId: z.string().trim().min(1, "请选择要调用的工作流"),
  variables: z.array(variableBindingSchema),
  paramTemplates: z.record(z.string(), z.string()),
})

export type WorkflowCallNodeConfig = z.infer<typeof workflowCallNodeConfigSchema>
```

Create `desktop/workflow-nodes/workflow-call/manifest.ts`:

```ts
import { Workflow } from "lucide-react"
import type { NodeManifest } from "../types"
import type { WorkflowCallNodeConfig } from "./schema"
import { workflowCallNodeConfigSchema } from "./schema"

export const workflowCallNodeManifest: NodeManifest<WorkflowCallNodeConfig> = {
  type: "workflow_call",
  title: "调用工作流",
  icon: Workflow,
  color: "bg-primary/10",
  defaultConfig: { workflowId: "", variables: [], paramTemplates: {} },
  ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
  cardSummary: (config) => ({
    title: config.workflowId ? "已选择工作流" : "未选择工作流",
    subtitle: Object.keys(config.paramTemplates).length > 0 ? `${Object.keys(config.paramTemplates).length} 个参数` : "无参数映射",
  }),
  configFields: [
    { name: "workflowId", kind: "select", label: "工作流" },
    { name: "variables", kind: "variable-binding-list", label: "变量绑定" },
    { name: "paramTemplates", kind: "record", label: "参数模板" },
  ],
  configSchema: workflowCallNodeConfigSchema,
}
```

Create `desktop/workflow-nodes/workflow-call/card.tsx`:

```tsx
import { cn } from "@/lib/utils"
import { NodeProgressBar, useRunningTimer } from "@/modules/workflow/runner/node-progress-bar"
import { CopyIdButton } from "@/modules/workflow/components/copy-id-button"
import { statusClass, type NodeStatus } from "../node-status-utils"
import { workflowCallNodeManifest } from "./manifest"
import type { WorkflowCallNodeConfig } from "./schema"

export function WorkflowCallNodeCard({ config, name, selected, status, progressLabel, startedAt, nodeId }: {
  config: WorkflowCallNodeConfig
  name?: string
  selected?: boolean
  status?: NodeStatus
  progressLabel?: string
  startedAt?: number
  nodeId?: string
}) {
  const Icon = workflowCallNodeManifest.icon
  const timer = useRunningTimer(startedAt, status === "running")
  const paramCount = Object.keys(config.paramTemplates).length

  return (
    <div className={cn("relative rounded-lg border bg-card px-3 py-2 w-56", status === "running" && "pb-4", selected && "ring-2 ring-primary", statusClass(status))}>
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">{name || "调用工作流"}</span>
        {nodeId ? <CopyIdButton id={nodeId} kind="node" /> : null}
        {status === "running" && timer && (
          <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{timer}</span>
        )}
      </div>
      {status === "running" && progressLabel ? (
        <p className="truncate text-[11px] text-muted-foreground">{progressLabel}</p>
      ) : (
        <>
          <p className="truncate text-[11px] text-muted-foreground">{config.workflowId || "未选择工作流"}</p>
          <p className="truncate text-[11px] text-muted-foreground opacity-70">{paramCount > 0 ? `${paramCount} 个参数` : "无参数映射"}</p>
        </>
      )}
      {status === "running" && <NodeProgressBar />}
    </div>
  )
}
```

Create `desktop/workflow-nodes/workflow-call/index.ts`:

```ts
export { workflowCallNodeManifest } from "./manifest"
export { workflowCallNodeExecutor } from "./executor.main"
export type { WorkflowCallNodeConfig } from "./schema"
```

- [ ] **Step 4: Register the node in main and renderer**

In `desktop/workflow-nodes/register.main.ts`, add:

```ts
import { workflowCallNodeManifest, workflowCallNodeExecutor } from "./workflow-call"
```

Then register it after existing nodes:

```ts
nodeTypeRegistry.register(workflowCallNodeManifest, workflowCallNodeExecutor)
```

In `desktop/workflow-nodes/register.renderer.ts`, add:

```ts
import { workflowCallNodeManifest } from "./workflow-call/manifest"
```

Then register it after existing manifests:

```ts
nodeTypeRegistry.registerManifest(workflowCallNodeManifest)
```

- [ ] **Step 5: Add editor and runner wrappers**

In `desktop/src/modules/workflow/editor/node-wrappers.tsx`, import:

```ts
import { WorkflowCallNodeCard } from "../../../../workflow-nodes/workflow-call/card"
import type { WorkflowCallNodeConfig } from "../../../../workflow-nodes/workflow-call/schema"
```

Add:

```tsx
export function WorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const name = (data as { name?: string }).name
  return (
    <NodeContextMenu nodeId={id} nodeType="workflow_call">
      <div>
        <Handle type="target" position={Position.Left} />
        <WorkflowCallNodeCard config={data as WorkflowCallNodeConfig} name={name} selected={selected} nodeId={id} />
        <Handle type="source" position={Position.Right} />
      </div>
    </NodeContextMenu>
  )
}
```

Add `workflow_call: WorkflowCallNodeWrapper` to `nodeTypes`.

In `desktop/src/modules/workflow/runner/runner-node-wrappers.tsx`, import:

```ts
import { WorkflowCallNodeCard } from "../../../../workflow-nodes/workflow-call/card"
import type { WorkflowCallNodeConfig } from "../../../../workflow-nodes/workflow-call/schema"
```

Add:

```tsx
function RunnerWorkflowCallNodeWrapper({ id, data, selected }: NodeProps) {
  const nodeResults = useContext(RunnerNodeResultsContext)
  const result = nodeResults[id]
  const name = (data as { name?: string }).name
  return (
    <div className="relative">
      <Handle type="target" position={Position.Left} />
      <WorkflowCallNodeCard
        config={data as WorkflowCallNodeConfig}
        name={name}
        selected={selected}
        status={result?.status}
        progressLabel={result?.progressLabel}
        startedAt={result?.startedAt}
      />
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
```

Add `workflow_call: RunnerWorkflowCallNodeWrapper` to `runnerNodeTypes`.

- [ ] **Step 6: Add minimal executor export so registration compiles before Task 3**

Create `desktop/workflow-nodes/workflow-call/executor.main.ts` with a failing minimal executor:

```ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { WorkflowCallNodeConfig } from "./schema"

export const workflowCallNodeExecutor: NodeExecutor<WorkflowCallNodeConfig> = {
  async execute(input: NodeExecutionInput<WorkflowCallNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    return {
      status: "failed",
      output: "",
      error: input.config.workflowId ? "调用工作流能力不可用" : "请选择要调用的工作流",
      durationMs: Date.now() - start,
    }
  },
}
```

- [ ] **Step 7: Run schema tests and node palette tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/schema.test.ts src/modules/workflow/editor/__tests__/node-palette.test.tsx
```

Expected: PASS.

- [ ] **Step 8: Commit node shell**

```bash
git add desktop/workflow-nodes/workflow-call desktop/workflow-nodes/register.main.ts desktop/workflow-nodes/register.renderer.ts desktop/src/modules/workflow/editor/node-wrappers.tsx desktop/src/modules/workflow/runner/runner-node-wrappers.tsx
git commit -m "feat(workflow): register workflow call node"
```

## Task 3: Runtime Contracts and Workflow Call Executor

**Files:**
- Modify: `desktop/workflow-nodes/types.ts`
- Replace: `desktop/workflow-nodes/workflow-call/executor.main.ts`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing executor tests**

Create `desktop/workflow-nodes/workflow-call/__tests__/executor.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"

vi.mock("../../../electron/services/log-store", () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { workflowCallNodeExecutor } from "../executor.main"
import type { NodeExecutionInput, NodeRuntimeDeps } from "../../types"
import type { WorkflowCallNodeConfig } from "../schema"
import type { WorkflowDefinition, WorkflowRunResult } from "../../../src/types/workflow"

const childDefinition: WorkflowDefinition = {
  id: "child-1",
  name: "子工作流",
  version: "v-child",
  createdAt: 0,
  updatedAt: 0,
  defaultProjectId: "child-project",
  params: [{ name: "topic", type: "text", default: null }],
  nodes: [],
  edges: [],
}

function makeResult(status: WorkflowRunResult["status"], output = "child end output"): WorkflowRunResult {
  return { status, output, nodeResults: {}, durationMs: 12 }
}

function makeInput(config: Partial<WorkflowCallNodeConfig>, runtimeDeps?: NodeRuntimeDeps): NodeExecutionInput<WorkflowCallNodeConfig> {
  return {
    config: {
      workflowId: "child-1",
      variables: [],
      paramTemplates: { topic: "请总结 {{topic}}" },
      ...config,
    },
    resolvedVariables: { topic: "搜索结果" },
    context: {
      workflowId: "parent-1",
      workflowName: "父工作流",
      runId: "parent-run",
      nodeId: "call-1",
      nodeName: "调用子流程",
      projectId: "parent-project",
      abortSignal: new AbortController().signal,
      workflowCallStack: [{ workflowId: "parent-1", workflowName: "父工作流" }],
    },
    agentDeps: { sendToAgent: vi.fn() },
    runtimeDeps,
  }
}

function deps(result: WorkflowRunResult = makeResult("completed")): NodeRuntimeDeps {
  return {
    processRunner: { run: vi.fn() },
    sendHttpRequest: vi.fn(),
    workflowCall: {
      getWorkflowDefinition: vi.fn().mockResolvedValue(childDefinition),
      runWorkflow: vi.fn().mockResolvedValue({ runId: "child-run", result }),
    },
  }
}

describe("workflowCallNodeExecutor", () => {
  it("fails when runtime dependency is missing", async () => {
    const result = await workflowCallNodeExecutor.execute(makeInput({}, undefined))
    expect(result.status).toBe("failed")
    expect(result.error).toBe("调用工作流能力不可用")
  })

  it("builds child params and returns child End output", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("success")
    expect(result.output).toBe("child end output")
    expect(result.outputs).toMatchObject({
      childWorkflowId: "child-1",
      childWorkflowName: "子工作流",
      childRunId: "child-run",
      childStatus: "completed",
    })
    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      definition: childDefinition,
      params: { topic: "请总结 搜索结果" },
      projectId: "child-project",
      parentWorkflowId: "parent-1",
      parentRunId: "parent-run",
      parentNodeId: "call-1",
      callStack: [
        { workflowId: "parent-1", workflowName: "父工作流" },
        { workflowId: "child-1", workflowName: "子工作流" },
      ],
    }))
  })

  it("inherits parent project when child has no default project", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue({
      ...childDefinition,
      defaultProjectId: undefined,
    })

    await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(runtimeDeps.workflowCall?.runWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "parent-project",
    }))
  })

  it("fails when child workflow is missing", async () => {
    const runtimeDeps = deps()
    vi.mocked(runtimeDeps.workflowCall!.getWorkflowDefinition).mockResolvedValue(null)

    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("子工作流不存在")
  })

  it("fails on indirect recursion", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, {
      ...runtimeDeps,
      workflowCall: {
        ...runtimeDeps.workflowCall!,
        getWorkflowDefinition: vi.fn().mockResolvedValue({ ...childDefinition, id: "parent-1", name: "父工作流" }),
      },
    }))

    expect(result.status).toBe("failed")
    expect(result.error).toBe("调用链包含循环：父工作流 -> 父工作流")
  })

  it("fails when nesting depth exceeds five workflows", async () => {
    const runtimeDeps = deps()
    const result = await workflowCallNodeExecutor.execute(makeInput({}, runtimeDeps))
    expect(result.status).toBe("success")

    const deepInput = makeInput({}, runtimeDeps)
    deepInput.context.workflowCallStack = [
      { workflowId: "wf-1", workflowName: "1" },
      { workflowId: "wf-2", workflowName: "2" },
      { workflowId: "wf-3", workflowName: "3" },
      { workflowId: "wf-4", workflowName: "4" },
      { workflowId: "wf-5", workflowName: "5" },
    ]
    const deepResult = await workflowCallNodeExecutor.execute(deepInput)
    expect(deepResult.status).toBe("failed")
    expect(deepResult.error).toBe("工作流嵌套层级超过 5")
  })

  it("maps failed child workflow to failed node", async () => {
    const result = await workflowCallNodeExecutor.execute(makeInput({}, deps(makeResult("failed"))))
    expect(result.status).toBe("failed")
    expect(result.error).toBe("子工作流执行失败")
  })
})
```

- [ ] **Step 2: Run executor tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/executor.test.ts
```

Expected: FAIL because `NodeRuntimeDeps.workflowCall` and the real executor behavior do not exist.

- [ ] **Step 3: Extend runtime types**

In `desktop/workflow-nodes/types.ts`, add imports:

```ts
import type { WorkflowDefinition, WorkflowRunResult } from "../src/types/workflow"
```

Keep the existing `WorkflowNodeUsageCostSnapshot` import by merging it with the new import:

```ts
import type { WorkflowDefinition, WorkflowRunResult, WorkflowNodeUsageCostSnapshot } from "../src/types/workflow"
```

Add:

```ts
export interface WorkflowCallStackEntry {
  workflowId: string
  workflowName?: string
}

export interface WorkflowCallRunInput {
  definition: WorkflowDefinition
  params: Record<string, unknown>
  projectId?: string
  triggerSource: string
  abortSignal: AbortSignal
  actor?: ActorIdentity
  parentWorkflowId?: string
  parentRunId: string
  parentNodeId?: string
  parentNodeName?: string
  callStack: readonly WorkflowCallStackEntry[]
}

export interface WorkflowCallRunOutput {
  runId: string
  result: WorkflowRunResult
}

export interface WorkflowCallRuntimeDeps {
  getWorkflowDefinition: (id: string) => Promise<WorkflowDefinition | null>
  runWorkflow: (input: WorkflowCallRunInput) => Promise<WorkflowCallRunOutput>
}
```

Extend `NodeRuntimeDeps`:

```ts
  workflowCall?: WorkflowCallRuntimeDeps
```

Extend `WorkflowRuntimeContext`:

```ts
  workflowCallStack?: readonly WorkflowCallStackEntry[]
```

- [ ] **Step 4: Replace the executor**

Replace `desktop/workflow-nodes/workflow-call/executor.main.ts` with:

```ts
import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult, WorkflowCallStackEntry } from "../types"
import { createMainLogger } from "../../electron/services/log-store"
import { workflowNodeLogContext } from "../log-context"
import { buildWorkflowCallParams } from "./params"
import type { WorkflowCallNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.workflow-call-executor")
const MAX_WORKFLOW_CALL_DEPTH = 5

export const workflowCallNodeExecutor: NodeExecutor<WorkflowCallNodeConfig> = {
  async execute(input: NodeExecutionInput<WorkflowCallNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps, resolvedVariables } = input
    const workflowCall = runtimeDeps?.workflowCall
    const logContext = workflowNodeLogContext(context)

    if (!workflowCall) {
      return { status: "failed", output: "", error: "调用工作流能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("loading_workflow", "加载子工作流…")
    const childDefinition = await workflowCall.getWorkflowDefinition(config.workflowId)
    if (!childDefinition) {
      return { status: "failed", output: "", error: "子工作流不存在", durationMs: Date.now() - start }
    }

    const parentStack = normalizeCallStack(context)
    if (parentStack.some((entry) => entry.workflowId === childDefinition.id)) {
      const chain = formatCallChain([...parentStack, { workflowId: childDefinition.id, workflowName: childDefinition.name }])
      return { status: "failed", output: "", error: `调用链包含循环：${chain}`, durationMs: Date.now() - start }
    }
    if (parentStack.length >= MAX_WORKFLOW_CALL_DEPTH) {
      return { status: "failed", output: "", error: "工作流嵌套层级超过 5", durationMs: Date.now() - start }
    }

    input.onProgress?.("building_params", "构建参数…")
    const paramResult = buildWorkflowCallParams({
      childDefinition,
      paramTemplates: config.paramTemplates,
      resolvedVariables,
    })
    if (paramResult.errors.length > 0) {
      return { status: "failed", output: "", error: paramResult.errors[0], durationMs: Date.now() - start }
    }

    const nextStack = [...parentStack, { workflowId: childDefinition.id, workflowName: childDefinition.name }]
    const childProjectId = childDefinition.defaultProjectId?.trim() || context.projectId
    logger.info("workflow call node executing", {
      ...logContext,
      childWorkflowId: childDefinition.id,
      childWorkflowName: childDefinition.name,
      paramKeys: Object.keys(paramResult.params),
      paramCount: Object.keys(paramResult.params).length,
      depth: nextStack.length,
    })

    input.onProgress?.("running_child_workflow", "运行子工作流…")
    const childRun = await workflowCall.runWorkflow({
      definition: childDefinition,
      params: paramResult.params,
      projectId: childProjectId,
      triggerSource: "workflow-call",
      abortSignal: context.abortSignal,
      actor: context.actor,
      parentWorkflowId: context.workflowId,
      parentRunId: context.runId,
      parentNodeId: context.nodeId,
      parentNodeName: context.nodeName,
      callStack: nextStack,
    })

    const durationMs = Date.now() - start
    const outputs = {
      childWorkflowId: childDefinition.id,
      childWorkflowName: childDefinition.name,
      childRunId: childRun.runId,
      childStatus: childRun.result.status,
    }

    if (childRun.result.status === "cancelled") {
      return { status: "cancelled", output: "", outputs, error: "子工作流已取消", durationMs }
    }
    if (childRun.result.status === "failed") {
      return { status: "failed", output: childRun.result.output ?? "", outputs, error: "子工作流执行失败", durationMs }
    }

    return { status: "success", output: childRun.result.output ?? "", outputs, durationMs }
  },
}

function normalizeCallStack(context: NodeExecutionInput<WorkflowCallNodeConfig>["context"]): readonly WorkflowCallStackEntry[] {
  if (context.workflowCallStack && context.workflowCallStack.length > 0) return context.workflowCallStack
  return context.workflowId ? [{ workflowId: context.workflowId, workflowName: context.workflowName }] : []
}

function formatCallChain(stack: readonly WorkflowCallStackEntry[]): string {
  return stack.map((entry) => entry.workflowName || entry.workflowId).join(" -> ")
}
```

- [ ] **Step 5: Run executor tests and typecheck this slice**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/executor.test.ts
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit runtime contract and executor**

```bash
git add desktop/workflow-nodes/types.ts desktop/workflow-nodes/workflow-call/executor.main.ts desktop/workflow-nodes/workflow-call/__tests__/executor.test.ts
git commit -m "feat(workflow): execute workflow call nodes"
```

## Task 4: Engine Call Stack and Child Workflow Runtime Injection

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-engine.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Test: `desktop/electron/services/__tests__/workflow-engine.test.ts`
- Test: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`

- [ ] **Step 1: Write failing engine tests for call stack propagation**

Add to `desktop/electron/services/__tests__/workflow-engine.test.ts`:

```ts
it("passes workflow call stack into node execution context", async () => {
  const seenStacks: unknown[] = []
  nodeTypeRegistry.register({
    type: "stack_probe",
    title: "Stack Probe",
    icon: promptNodeManifest.icon,
    color: "bg-primary/10",
    defaultConfig: {},
    ports: { inputs: [{ id: "in", label: "输入" }], outputs: [{ id: "out", label: "输出" }] },
    cardSummary: () => ({ title: "Stack Probe", subtitle: "" }),
    configFields: [],
    configSchema: { parse: (value: unknown) => value, safeParse: (value: unknown) => ({ success: true, data: value }) } as never,
  }, {
    async execute(input) {
      seenStacks.push(input.context.workflowCallStack)
      return { status: "success", output: "probe", durationMs: 1 }
    },
  })

  const def: WorkflowDefinition = {
    id: "wf-stack",
    name: "Stack WF",
    version: "v1",
    createdAt: 0,
    updatedAt: 0,
    params: [],
    nodes: [
      { id: "probe", name: "Probe", type: "stack_probe", position: { x: 0, y: 0 }, config: {} },
      nodeEnd,
    ],
    edges: [{ id: "e1", from: "probe", to: "end" }],
  }

  const engine = new WorkflowEngine(fakeAgent("unused"))
  await engine.run(def, {}, "run-stack", () => {}, undefined, undefined, "test", undefined, [
    { workflowId: "parent", workflowName: "Parent" },
    { workflowId: "wf-stack", workflowName: "Stack WF" },
  ])

  expect(seenStacks).toEqual([[
    { workflowId: "parent", workflowName: "Parent" },
    { workflowId: "wf-stack", workflowName: "Stack WF" },
  ]])
})
```

- [ ] **Step 2: Run engine test and verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts --testNamePattern "passes workflow call stack"
```

Expected: FAIL because `WorkflowEngine.run` does not accept or pass call stack.

- [ ] **Step 3: Thread call stack through `WorkflowEngine.run`**

In `desktop/electron/services/workflow/workflow-engine.ts`, import `WorkflowCallStackEntry` from node types:

```ts
import type { AgentSendDeps, NodeExecutionResult, NodeRuntimeDeps, WorkflowCallStackEntry } from "../../../workflow-nodes/types"
```

Add the final optional parameter to `run`:

```ts
    callStack?: readonly WorkflowCallStackEntry[],
```

Immediately after `const nodeOutputs: Record<string, string> = {}`, add:

```ts
    const workflowCallStack: readonly WorkflowCallStackEntry[] = callStack && callStack.length > 0
      ? callStack
      : [{ workflowId: def.id, workflowName: def.name }]
```

Inside the `executor.execute` context object, add:

```ts
              workflowCallStack,
```

- [ ] **Step 4: Inject workflow call runtime dependency in bootstrap**

In `desktop/electron/bootstrap/descriptors.ts`, add `"core.workflow"` to `coreWorkflowEngineDescriptor.dependsOn`.

Inside `create(ctx)`, before `const runtimeDeps`, add:

```ts
    const workflowService = registry.get<WorkflowService>("core.workflow")
    let workflowEngine: WorkflowEngine
```

Add `workflowCall` to `runtimeDeps`:

```ts
      workflowCall: {
        getWorkflowDefinition: (id) => workflowService.get(id),
        runWorkflow: async (input) => {
          const runId = randomUUID()
          const result = await workflowEngine.run(
            input.definition,
            input.params,
            runId,
            () => undefined,
            input.abortSignal,
            input.projectId,
            input.triggerSource,
            input.actor,
            input.callStack,
          )
          return { runId, result }
        },
      },
```

Replace the return statement with:

```ts
    workflowEngine = new WorkflowEngine({ sendToAgent }, undefined, runtimeDeps)
    return workflowEngine
```

- [ ] **Step 5: Add bootstrap test for injected workflow call dependency**

Add to `desktop/electron/bootstrap/__tests__/descriptors.test.ts`:

```ts
it("coreWorkflowEngineDescriptor injects workflow call runtime dependency", async () => {
  const { coreWorkflowEngineDescriptor } = await importBootstrap()
  const workflowService = { get: vi.fn().mockResolvedValue(null) }
  const containers = { open: vi.fn() }
  const permissionGuard = { check: vi.fn() }
  const auditSink = { record: vi.fn() }
  const ctx = {
    ...makeFakeContext(),
    registry: {
      get: vi.fn((serviceId: string) => {
        if (serviceId === "core.workflow") return workflowService
        if (serviceId === "core.project-containers") return containers
        if (serviceId === "core.permission-guard") return permissionGuard
        if (serviceId === "core.audit-sink") return auditSink
        throw new Error(`Unexpected service id: ${serviceId}`)
      }),
    },
  }

  const engine = coreWorkflowEngineDescriptor.create(ctx as never) as unknown as {
    runtimeDeps: {
      workflowCall?: {
        getWorkflowDefinition: (id: string) => Promise<unknown>
      }
    }
  }

  await expect(engine.runtimeDeps.workflowCall?.getWorkflowDefinition("child-1")).resolves.toBeNull()
  expect(workflowService.get).toHaveBeenCalledWith("child-1")
})
```

- [ ] **Step 6: Run engine and bootstrap tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-engine.test.ts electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit engine and bootstrap wiring**

```bash
git add desktop/electron/services/workflow/workflow-engine.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/services/__tests__/workflow-engine.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat(workflow): wire child workflow execution"
```

## Task 5: Workflow Call Validation

**Files:**
- Modify: `desktop/electron/services/workflow/workflow-validator.ts`
- Test: `desktop/electron/services/__tests__/workflow-validator.test.ts`

- [ ] **Step 1: Write failing validator tests**

Add to `desktop/electron/services/__tests__/workflow-validator.test.ts`:

```ts
it("rejects workflow_call nodes that call the current workflow", () => {
  const endForCall = {
    ...nodeEnd,
    config: {
      outputType: "text",
      template: "{{result}}",
      variables: [{ name: "result", source: { type: "node_output", node: "call" } }],
    },
  }
  const def: WorkflowDefinition = {
    ...base,
    id: "wf-self",
    nodes: [
      { id: "call", name: "Call", type: "workflow_call", position: { x: 0, y: 0 }, config: { workflowId: "wf-self", variables: [], paramTemplates: {} } },
      endForCall,
    ],
    edges: [{ id: "e1", from: "call", to: "end" }],
  }

  const result = validateWorkflow(def)

  expect(result.valid).toBe(false)
  expect(result.errors.some((error) => error.message.includes("不能调用当前工作流"))).toBe(true)
})

it("rejects workflow_call templates that reference unbound variables", () => {
  const endForCall = {
    ...nodeEnd,
    config: {
      outputType: "text",
      template: "{{result}}",
      variables: [{ name: "result", source: { type: "node_output", node: "call" } }],
    },
  }
  const def: WorkflowDefinition = {
    ...base,
    nodes: [
      { id: "call", name: "Call", type: "workflow_call", position: { x: 0, y: 0 }, config: { workflowId: "child", variables: [], paramTemplates: { topic: "请总结 {{topic}}" } } },
      endForCall,
    ],
    edges: [{ id: "e1", from: "call", to: "end" }],
  }

  const result = validateWorkflow(def)

  expect(result.valid).toBe(false)
  expect(result.errors.some((error) => error.message.includes("模板变量「topic」未绑定"))).toBe(true)
})
```

- [ ] **Step 2: Run validator tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-validator.test.ts --testNamePattern "workflow_call"
```

Expected: FAIL because validator has no `workflow_call` specific checks.

- [ ] **Step 3: Add workflow call validation**

In `desktop/electron/services/workflow/workflow-validator.ts`, import:

```ts
import { extractWorkflowCallTemplateVariables } from "../../../workflow-nodes/workflow-call/params"
```

Inside the node loop, after schema validation and before template validation, add:

```ts
    if (node.type === "workflow_call") {
      const cfg = node.config as Record<string, unknown>
      const childWorkflowId = typeof cfg.workflowId === "string" ? cfg.workflowId.trim() : ""
      if (!childWorkflowId) {
        errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, field: "workflowId", message: `节点「${node.name}」请选择要调用的工作流` })
      } else if (childWorkflowId === def.id) {
        errors.push({ type: "invalid_config", nodeId: node.id, nodeName: node.name, field: "workflowId", message: `节点「${node.name}」不能调用当前工作流` })
      }

      const templates = cfg.paramTemplates
      const templateValues = templates && typeof templates === "object" && !Array.isArray(templates)
        ? Object.values(templates as Record<string, unknown>)
        : []
      const boundNames = new Set(
        (Array.isArray(vars) ? vars : [])
          .map((variable) => (variable as Record<string, unknown>).name as string)
          .filter(Boolean),
      )
      for (const value of templateValues) {
        if (typeof value !== "string") continue
        for (const placeholder of extractWorkflowCallTemplateVariables(value)) {
          if (!boundNames.has(placeholder)) {
            errors.push({
              type: "invalid_config",
              nodeId: node.id,
              nodeName: node.name,
              field: "paramTemplates",
              message: `节点「${node.name}」的模板变量「${placeholder}」未绑定，请在节点变量中添加绑定`,
            })
          }
        }
      }
    }
```

- [ ] **Step 4: Run validator tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run electron/services/__tests__/workflow-validator.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit validation**

```bash
git add desktop/electron/services/workflow/workflow-validator.ts desktop/electron/services/__tests__/workflow-validator.test.ts
git commit -m "feat(workflow): validate workflow call nodes"
```

## Task 6: Renderer Configuration Panel

**Files:**
- Create: `desktop/workflow-nodes/workflow-call/panel.tsx`
- Modify: `desktop/workflow-nodes/panel-registry.ts`
- Modify: `desktop/src/modules/workflow/editor/node-config-panel.tsx`
- Test: `desktop/workflow-nodes/workflow-call/__tests__/panel.test.tsx`

- [ ] **Step 1: Write failing panel tests**

Create `desktop/workflow-nodes/workflow-call/__tests__/panel.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { WorkflowCallNodePanel } from "../panel"
import type { WorkflowCallNodeConfig } from "../schema"

const workflowList = vi.fn()
const workflowGet = vi.fn()

Object.defineProperty(window, "synapse", {
  value: {
    workflow: {
      list: workflowList,
      get: workflowGet,
    },
  },
  configurable: true,
})

function renderPanel(config: WorkflowCallNodeConfig, onChange = vi.fn()) {
  render(
    <WorkflowCallNodePanel
      config={config}
      onChange={onChange}
      upstreamNodes={[]}
      workflowParams={[{ name: "topic", type: "text", default: null }]}
      projects={[]}
      currentWorkflowId="parent"
    />,
  )
  return onChange
}

describe("WorkflowCallNodePanel", () => {
  it("loads child params and renders parameter templates", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null, description: "主题" }],
      nodes: [],
      edges: [],
    })

    renderPanel({ workflowId: "child", variables: [], paramTemplates: { topic: "请总结 {{topic}}" } })

    expect(await screen.findByText("子工作流")).toBeInTheDocument()
    expect(await screen.findByText("主题")).toBeInTheDocument()
    expect(screen.getByDisplayValue("请总结 {{topic}}")).toBeInTheDocument()
  })

  it("does not list the current workflow as a child option", async () => {
    workflowList.mockResolvedValue([
      { id: "parent", name: "父工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 },
      { id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 },
    ])
    workflowGet.mockResolvedValue(null)

    renderPanel({ workflowId: "", variables: [], paramTemplates: {} })

    expect(await screen.findByText("子工作流")).toBeInTheDocument()
    expect(screen.queryByText("父工作流")).toBeNull()
  })

  it("updates templates on blur", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null }],
      nodes: [],
      edges: [],
    })
    const onChange = renderPanel({ workflowId: "child", variables: [], paramTemplates: { topic: "" } })

    const input = await screen.findByLabelText("topic")
    await userEvent.clear(input)
    await userEvent.type(input, "请总结 {{topic}}")
    input.blur()

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        paramTemplates: { topic: "请总结 {{topic}}" },
      }))
    })
  })

  it("auto-fills same-name parent params when child params load", async () => {
    workflowList.mockResolvedValue([{ id: "child", name: "子工作流", version: "v1", nodeCount: 1, createdAt: 0, updatedAt: 0 }])
    workflowGet.mockResolvedValue({
      id: "child",
      name: "子工作流",
      version: "v1",
      createdAt: 0,
      updatedAt: 0,
      params: [{ name: "topic", type: "text", default: null }],
      nodes: [],
      edges: [],
    })
    const onChange = renderPanel({ workflowId: "child", variables: [], paramTemplates: {} })

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
        paramTemplates: { topic: "{{topic}}" },
      }))
    })
  })
})
```

- [ ] **Step 2: Run panel tests and verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/panel.test.tsx
```

Expected: FAIL because `panel.tsx` does not exist.

- [ ] **Step 3: Extend panel registry props**

In `desktop/workflow-nodes/panel-registry.ts`, add to `NodePanelProps`:

```ts
  currentWorkflowId?: string
```

Import and register:

```ts
import { WorkflowCallNodePanel } from "./workflow-call/panel"
```

Add to the map:

```ts
  ["workflow_call", WorkflowCallNodePanel as unknown as PanelComponent],
```

In `desktop/src/modules/workflow/editor/node-config-panel.tsx`, pass the current workflow ID into `PanelComponent`:

```tsx
                      currentWorkflowId={definition.id}
```

- [ ] **Step 4: Implement panel**

Create `desktop/workflow-nodes/workflow-call/panel.tsx`:

```tsx
import { useEffect, useMemo, useRef, useState } from "react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { WorkflowMeta, WorkflowParam } from "@/types/workflow"
import type { WorkflowCallNodeConfig } from "./schema"
import { CollapsibleSection } from "../collapsible-section"
import { VariableBindingEditor } from "../variable-binding-editor"

export interface WorkflowCallNodePanelProps {
  config: WorkflowCallNodeConfig
  onChange: (config: WorkflowCallNodeConfig) => void
  upstreamNodes: { id: string; name: string }[]
  workflowParams: WorkflowParam[]
  currentWorkflowId?: string
}

export function WorkflowCallNodePanel({ config, onChange, upstreamNodes, workflowParams, currentWorkflowId }: WorkflowCallNodePanelProps) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [childParams, setChildParams] = useState<WorkflowParam[]>([])
  const [templates, setTemplates] = useState<Record<string, string>>(config.paramTemplates)
  const lastCommittedRef = useRef<WorkflowCallNodeConfig>(config)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const items = await window.synapse?.workflow.list()
      if (!cancelled) setWorkflows((items ?? []).filter((item) => item.id !== currentWorkflowId))
    })()
    return () => { cancelled = true }
  }, [currentWorkflowId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!config.workflowId) {
        setChildParams([])
        return
      }
      const child = await window.synapse?.workflow.get(config.workflowId)
      if (cancelled) return
      const nextParams = child?.params ?? []
      setChildParams(nextParams)
      const withInitialTemplates = buildInitialParamTemplates(lastCommittedRef.current, nextParams, workflowParams)
      if (withInitialTemplates !== lastCommittedRef.current) {
        lastCommittedRef.current = withInitialTemplates
        setTemplates(withInitialTemplates.paramTemplates)
        onChange(withInitialTemplates)
      }
    })()
    return () => { cancelled = true }
  }, [config.workflowId, onChange, workflowParams])

  useEffect(() => {
    setTemplates(config.paramTemplates)
    lastCommittedRef.current = config
  }, [config])

  const selectedWorkflowName = useMemo(
    () => workflows.find((workflow) => workflow.id === config.workflowId)?.name,
    [workflows, config.workflowId],
  )

  const commit = (patch: Partial<WorkflowCallNodeConfig>) => {
    const next = { ...lastCommittedRef.current, ...patch }
    lastCommittedRef.current = next
    onChange(next)
  }

  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const templateSummary = childParams.length > 0 ? `${childParams.length}个` : undefined

  return (
    <div className="grid gap-2">
      <CollapsibleSection title="工作流" summary={selectedWorkflowName}>
        <div className="grid gap-1.5">
          <Label className="text-xs">工作流</Label>
          <Select value={config.workflowId} onValueChange={(workflowId) => commit({ workflowId })}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="选择工作流" />
            </SelectTrigger>
            <SelectContent>
              {workflows.map((workflow) => (
                <SelectItem key={workflow.id} value={workflow.id}>{workflow.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="输入映射" summary={config.variables.length > 0 ? `${config.variables.length}个` : undefined}>
        <VariableBindingEditor
          variables={config.variables}
          onChange={(variables) => commit({ variables })}
          upstreamNodes={upstreamNodes}
          workflowParams={workflowParams}
        />
      </CollapsibleSection>

      <CollapsibleSection title="参数" summary={templateSummary}>
        <div className="grid gap-2">
          {childParams.length === 0 ? (
            <p className="text-xs text-muted-foreground">暂无参数</p>
          ) : childParams.map((param) => (
            <div key={param.name} className="grid gap-1.5">
              <Label htmlFor={`workflow-call-param-${param.name}`} className="text-xs">{param.description ?? param.name}</Label>
              <Textarea
                id={`workflow-call-param-${param.name}`}
                aria-label={param.description ?? param.name}
                className="min-h-16 resize-none text-xs"
                value={templates[param.name] ?? ""}
                onChange={(event) => setTemplates((current) => ({ ...current, [param.name]: event.target.value }))}
                onBlur={() => commit({ paramTemplates: templates })}
                placeholder={param.default !== null ? "使用子工作流默认值" : "输入模板"}
              />
              {templates[param.name] && extractLooseTemplateNames(templates[param.name]).some((name) => !variableNames.has(name)) ? (
                <p className="text-xs text-destructive">存在未绑定变量</p>
              ) : null}
            </div>
          ))}
        </div>
      </CollapsibleSection>
    </div>
  )
}

function extractLooseTemplateNames(template: string): string[] {
  return [...template.matchAll(/\{\{\s*\$?([\p{L}\p{N}_.-]+)\s*\}\}/gu)].map((match) => match[1])
}

function buildInitialParamTemplates(config: WorkflowCallNodeConfig, childParams: WorkflowParam[], workflowParams: WorkflowParam[]): WorkflowCallNodeConfig {
  const parentParamNames = new Set(workflowParams.map((param) => param.name))
  const variableNames = new Set(config.variables.map((variable) => variable.name).filter(Boolean))
  const nextTemplates = { ...config.paramTemplates }
  let changed = false

  for (const param of childParams) {
    if (nextTemplates[param.name] !== undefined) continue
    if (parentParamNames.has(param.name) || variableNames.has(param.name)) {
      nextTemplates[param.name] = `{{${param.name}}}`
      changed = true
    }
  }

  return changed ? { ...config, paramTemplates: nextTemplates } : config
}
```

- [ ] **Step 5: Run panel tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call/__tests__/panel.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit renderer panel**

```bash
git add desktop/workflow-nodes/workflow-call/panel.tsx desktop/workflow-nodes/workflow-call/__tests__/panel.test.tsx desktop/workflow-nodes/panel-registry.ts desktop/src/modules/workflow/editor/node-config-panel.tsx
git commit -m "feat(workflow): configure workflow call nodes"
```

## Task 7: Release Note and Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append under the existing pending release notes section:

```md
- 工作流新增“调用工作流”节点，可以在父工作流里自动传入参数并复用另一个工作流，复杂流程可以拆分成更小的可维护步骤。
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run workflow-nodes/workflow-call electron/services/__tests__/workflow-engine.test.ts electron/services/__tests__/workflow-validator.test.ts src/modules/workflow/editor/__tests__/node-palette.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 5: Run full desktop test suite**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 6: Commit release note and verification fixes**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note workflow call node"
```

## Self-Review

Spec coverage:

- Automatic execution without runtime popups is covered by the executor path and no new IPC prompt flow.
- Parameter templates with variable interpolation are covered by Task 1 and Task 6.
- End-only output is covered by Task 3 executor tests.
- Current saved child version is covered by `getWorkflowDefinition(config.workflowId)` in Task 3 and bootstrap wiring in Task 4.
- Direct self-call validation is covered by Task 5.
- Indirect recursion and max depth are covered by Task 3 executor tests.
- No child Runner window is opened because Task 4 child execution calls `WorkflowEngine.run` directly and uses a no-op event sink.
- Logs avoid param values because Task 3 executor logs `paramKeys` and `paramCount`, not rendered values.
- Release note requirement is covered by Task 7.

Type consistency:

- Node type string is `workflow_call` across schema, manifest, registration, wrappers, panel registry, and validator.
- Runtime dependency field is `runtimeDeps.workflowCall`.
- Call stack context field is `workflowCallStack`.
- Child run output fields are `childWorkflowId`, `childWorkflowName`, `childRunId`, and `childStatus`.
