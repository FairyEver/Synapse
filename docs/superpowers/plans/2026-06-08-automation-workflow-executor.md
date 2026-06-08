# Automation Workflow Executor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `工作流` executor to Automation so Cron, interval, and Webhook triggers can run a saved Workflow with mapped parameters.

**Architecture:** Implement `builtin.workflow` as a normal Action Runtime package with main and renderer halves. The main executor receives a narrow injected Workflow runtime dependency, renders Automation template variables into Workflow params, waits for the Workflow run terminal state, and maps it back to an Automation action result. The renderer config form reads Workflow metadata through the existing preload workflow bridge and stays inside the current two-column Automation editor.

**Tech Stack:** Electron main process, React, TypeScript, zod, shadcn/Radix UI, Vitest, existing Synapse Action Runtime, Automation, and Workflow services.

---

## File Structure

- Create `desktop/action-packages/builtin/workflow/schema.ts`
  - Owns `WorkflowActionConfig`, zod validation, parameter rendering helpers, and result output types.
- Create `desktop/action-packages/builtin/workflow/manifest.ts`
  - Defines `builtin.workflow` manifest, default config, config fields, and stored-config validation.
- Create `desktop/action-packages/builtin/workflow/config.renderer.tsx`
  - Renders the Automation editor right-panel form for selecting a Workflow and mapping params.
- Create `desktop/action-packages/builtin/workflow/executor.main.ts`
  - Builds the `workflow.run` permission request and executes a Workflow through injected runtime deps.
- Create `desktop/action-packages/builtin/workflow/result.renderer.tsx`
  - Renders Workflow action output in Automation run history and opens Workflow Runner.
- Create `desktop/action-packages/builtin/workflow/index.ts` and `index.shared.ts`
  - Export the manifest, schema, config form, result view, and executor.
- Modify `desktop/src/action-runtime/builtin-actions.ts`
  - Register renderer `builtin.workflow`.
- Modify `desktop/electron/action-runtime/builtin-actions.ts`
  - Register main `builtin.workflow` when Workflow runtime deps are supplied.
- Modify `desktop/electron/bootstrap/descriptors.ts`
  - Add Workflow runtime deps to the action runtime descriptor and extract a waitable Workflow run helper.
- Modify `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
  - Cover selecting Workflow in the Automation editor.
- Add tests under `desktop/action-packages/builtin/workflow/__tests__/`
  - Cover schema, config renderer, executor success/failure/cancel/permission, and result renderer behavior.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add a user-facing pending release note for the new Automation Workflow action.

---

### Task 1: Workflow Action Schema And Manifest

**Files:**
- Create: `desktop/action-packages/builtin/workflow/schema.ts`
- Create: `desktop/action-packages/builtin/workflow/manifest.ts`
- Create: `desktop/action-packages/builtin/workflow/index.shared.ts`
- Test: `desktop/action-packages/builtin/workflow/__tests__/schema.test.ts`
- Test: `desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts`

- [ ] **Step 1: Write failing schema tests**

Create `desktop/action-packages/builtin/workflow/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildWorkflowRunParams,
  workflowActionConfigSchema,
} from "../schema"
import type { WorkflowParam } from "../../../../src/types/workflow"

const params: WorkflowParam[] = [
  { name: "topic", type: "text", default: null, description: "主题" },
  { name: "limit", type: "number", default: 10, description: "数量" },
]

describe("workflow action schema", () => {
  it("parses workflow id and parameter templates", () => {
    const parsed = workflowActionConfigSchema.parse({
      workflowId: "wf-1",
      paramTemplates: { topic: "日报 {{trigger.triggeredAt}}", limit: "5" },
    })

    expect(parsed).toEqual({
      workflowId: "wf-1",
      paramTemplates: { topic: "日报 {{trigger.triggeredAt}}", limit: "5" },
    })
  })

  it("builds workflow params from templates and workflow defaults", () => {
    const built = buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "{{trigger.request.body.title}}", limit: "" },
      templateVariables: { "trigger.request.body.title": "发布总结" },
    })

    expect(built).toEqual({ topic: "发布总结", limit: 10 })
  })

  it("rejects missing required text params", () => {
    expect(() => buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "", limit: "" },
      templateVariables: {},
    })).toThrow("参数「topic」不能为空")
  })

  it("rejects invalid number params after rendering", () => {
    expect(() => buildWorkflowRunParams({
      workflowParams: params,
      paramTemplates: { topic: "发布总结", limit: "{{trigger.request.body.limit}}" },
      templateVariables: { "trigger.request.body.limit": "many" },
    })).toThrow("参数「limit」必须是数字")
  })
})
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/schema.test.ts
```

Expected: FAIL because `desktop/action-packages/builtin/workflow/schema.ts` does not exist.

- [ ] **Step 3: Implement schema and param builder**

Create `desktop/action-packages/builtin/workflow/schema.ts`:

```ts
import { z } from "zod"

import { renderActionTemplate } from "../../../electron/action-runtime/template-variables"
import type {
  WorkflowParam,
  WorkflowRunResult,
} from "../../../src/types/workflow"

export const workflowActionConfigSchema = z.object({
  workflowId: z.string().default(""),
  paramTemplates: z.record(z.string(), z.string()).default({}),
})

export type WorkflowActionConfig = z.infer<typeof workflowActionConfigSchema>

export type WorkflowActionStatus = "completed" | "failed" | "cancelled"

export interface WorkflowActionOutputs {
  readonly workflowId: string
  readonly workflowName: string
  readonly workflowRunId: string
  readonly workflowStatus: WorkflowActionStatus
  readonly output?: string
}

export interface WorkflowRunParamBuildInput {
  readonly workflowParams: readonly WorkflowParam[]
  readonly paramTemplates: Record<string, string>
  readonly templateVariables?: Record<string, string>
}

export function buildWorkflowRunParams(input: WorkflowRunParamBuildInput): Record<string, unknown> {
  const result: Record<string, unknown> = {}

  for (const param of input.workflowParams) {
    const template = input.paramTemplates[param.name] ?? ""
    const rendered = template.trim()
      ? renderActionTemplate(template, input.templateVariables)
      : ""

    if (!rendered && param.default !== null) {
      result[param.name] = param.default
      continue
    }

    if (!rendered) {
      throw new Error(`参数「${param.description ?? param.name}」不能为空`)
    }

    if (param.type === "number") {
      const numeric = Number(rendered)
      if (Number.isNaN(numeric)) {
        throw new Error(`参数「${param.description ?? param.name}」必须是数字`)
      }
      result[param.name] = numeric
      continue
    }

    result[param.name] = rendered
  }

  return result
}

export function workflowStatusToActionStatus(status: WorkflowRunResult["status"]) {
  return status === "completed" ? "success" : status === "cancelled" ? "cancelled" : "failed"
}
```

- [ ] **Step 4: Run schema tests to verify they pass**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Write failing manifest tests**

Create `desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { workflowActionManifest } from "../manifest"

describe("workflow action manifest", () => {
  it("declares the workflow action contract", () => {
    expect(workflowActionManifest.id).toBe("builtin.workflow")
    expect(workflowActionManifest.title).toBe("工作流")
    expect(workflowActionManifest.permissions).toEqual(["workflow.run"])
    expect(workflowActionManifest.defaultConfig).toEqual({
      workflowId: "",
      paramTemplates: {},
    })
    expect(workflowActionManifest.configFields.map((field) => field.name)).toEqual([
      "workflowId",
      "paramTemplates",
    ])
  })

  it("marks empty workflow id as needing update", () => {
    expect(workflowActionManifest.validateStoredConfig?.({
      workflowId: "",
      paramTemplates: {},
    })).toEqual({
      status: "needs_update",
      issues: [{ field: "workflowId", message: "选择工作流" }],
    })
  })
})
```

- [ ] **Step 6: Run manifest tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts
```

Expected: FAIL because `manifest.ts` does not exist.

- [ ] **Step 7: Implement manifest and shared exports**

Create `desktop/action-packages/builtin/workflow/manifest.ts`:

```ts
import type { ActionManifest, ActionStoredConfigValidation } from "../../types"
import { workflowActionConfigSchema, type WorkflowActionConfig } from "./schema"

export const workflowActionManifest = {
  id: "builtin.workflow",
  title: "工作流",
  permissions: ["workflow.run"],
  defaultConfig: {
    workflowId: "",
    paramTemplates: {},
  },
  configFields: [
    {
      name: "workflowId",
      kind: "string",
      required: true,
      description: "Workflow ID.",
    },
    {
      name: "paramTemplates",
      kind: "record",
      required: false,
      description: "Workflow parameter templates.",
    },
  ],
  configSchema: workflowActionConfigSchema,
  validateStoredConfig,
} satisfies ActionManifest<WorkflowActionConfig>

function validateStoredConfig(config: Record<string, unknown>): ActionStoredConfigValidation {
  const parsed = workflowActionConfigSchema.safeParse(config)
  if (!parsed.success) {
    return { status: "needs_update", issues: [{ field: "workflow.config", message: "检查工作流" }] }
  }
  if (!parsed.data.workflowId.trim()) {
    return { status: "needs_update", issues: [{ field: "workflowId", message: "选择工作流" }] }
  }
  return { status: "valid", issues: [] }
}
```

Create `desktop/action-packages/builtin/workflow/index.shared.ts`:

```ts
export { workflowActionManifest } from "./manifest"
export {
  buildWorkflowRunParams,
  workflowActionConfigSchema,
  workflowStatusToActionStatus,
  type WorkflowActionConfig,
  type WorkflowActionOutputs,
} from "./schema"
```

- [ ] **Step 8: Run task tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/action-packages/builtin/workflow/__tests__/schema.test.ts \
  desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add desktop/action-packages/builtin/workflow/schema.ts \
  desktop/action-packages/builtin/workflow/manifest.ts \
  desktop/action-packages/builtin/workflow/index.shared.ts \
  desktop/action-packages/builtin/workflow/__tests__/schema.test.ts \
  desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts
git commit -m "feat(automation): add workflow action schema"
```

---

### Task 2: Waitable Workflow Runtime Helper

**Files:**
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Test: `desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts`

- [ ] **Step 1: Write failing helper tests**

Create `desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import type { WorkflowDefinition, WorkflowEvent } from "../../../src/types/workflow"
import { createRunWorkflowAndWait } from "../descriptors"

const definition: WorkflowDefinition = {
  id: "wf-1",
  name: "每日汇总",
  version: "v1",
  createdAt: 1,
  updatedAt: 2,
  params: [],
  nodes: [{ id: "end", name: "结束", type: "end", position: { x: 0, y: 0 }, config: {} }],
  edges: [],
}

describe("createRunWorkflowAndWait", () => {
  it("resolves with run result when the workflow completes", async () => {
    const workflowEngine = {
      run: vi.fn(async (
        _def: WorkflowDefinition,
        _params: Record<string, unknown>,
        runId: string,
        emit: (event: WorkflowEvent) => void,
      ) => {
        emit({ type: "workflow:completed", runId, workflowId: "wf-1", result: { status: "completed", nodeResults: {}, durationMs: 12, output: "done" } })
        return { status: "completed", nodeResults: {}, durationMs: 12, output: "done" }
      }),
    }
    const runWorkflowAndWait = createRunWorkflowAndWait({
      workflowService: { get: vi.fn(async () => definition) },
      workflowEngine: workflowEngine as never,
      snapshotService: { save: vi.fn(async () => undefined) },
      eventBus: { emit: vi.fn() } as never,
      runAborts: new Map(),
      runStatuses: new Map(),
      runCompletions: new Map(),
      capabilityLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    })

    await expect(runWorkflowAndWait({
      workflowId: "wf-1",
      params: {},
      abortSignal: new AbortController().signal,
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
    })).resolves.toMatchObject({
      definition,
      result: { status: "completed", output: "done" },
    })
  })

  it("aborts the workflow run when the outer signal aborts", async () => {
    const runAborts = new Map<string, AbortController>()
    const outer = new AbortController()
    const runWorkflowAndWait = createRunWorkflowAndWait({
      workflowService: { get: vi.fn(async () => definition) },
      workflowEngine: {
        run: vi.fn(async () => {
          outer.abort()
          return { status: "cancelled", nodeResults: {}, durationMs: 1 }
        }),
      } as never,
      snapshotService: { save: vi.fn(async () => undefined) },
      eventBus: { emit: vi.fn() } as never,
      runAborts,
      runStatuses: new Map(),
      runCompletions: new Map(),
      capabilityLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } as never,
    })

    await runWorkflowAndWait({
      workflowId: "wf-1",
      params: {},
      abortSignal: outer.signal,
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
    })

    expect([...runAborts.values()].every((controller) => controller.signal.aborted)).toBe(true)
  })
})
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts
```

Expected: FAIL because `createRunWorkflowAndWait` is not exported.

- [ ] **Step 3: Extract waitable helper**

Modify `desktop/electron/bootstrap/descriptors.ts`:

```ts
export function createRunWorkflowAndWait(deps: {
  workflowService: Pick<WorkflowService, "get">
  workflowEngine: WorkflowEngine
  snapshotService: Pick<RunSnapshotService, "save">
  eventBus: EventBus
  runAborts: Map<string, AbortController>
  runStatuses: Map<string, WorkflowRunStatus>
  runCompletions: Map<string, Promise<unknown>>
  capabilityLogger: ReturnType<typeof createMainLogger>
  isWorkflowDeleted?: (workflowId: string) => boolean
}) {
  return async (input: {
    workflowId: string
    params: Record<string, unknown>
    abortSignal?: AbortSignal
    triggerSource: "mcp" | "automation"
    automationId?: string
    automationRunId?: string
  }) => {
    const handler = createRunWorkflowHandler(deps)
    const started = await handler(input.workflowId, input.params, {
      abortSignal: input.abortSignal,
      triggerSource: input.triggerSource,
      automationId: input.automationId,
      automationRunId: input.automationRunId,
    })
    if ("errors" in started) {
      throw new Error(started.errors[0]?.message ?? "工作流启动失败")
    }
    const completion = deps.runCompletions.get(started.runId)
    if (completion) await completion
    const status = deps.runStatuses.get(started.runId)
    const definition = await deps.workflowService.get(input.workflowId)
    if (!definition) throw new Error("工作流不存在")
    if (!status || status.status === "running") throw new Error("工作流状态未知")
    return {
      runId: started.runId,
      definition,
      result: {
        status: status.status,
        nodeResults: status.nodeResults,
        durationMs: status.durationMs ?? 0,
        output: status.nodeResults.end?.output,
      },
    }
  }
}
```

Also update `createRunWorkflowHandler` to accept optional run options:

```ts
type RunWorkflowHandlerOptions = {
  readonly abortSignal?: AbortSignal
  readonly triggerSource?: "mcp" | "automation"
  readonly automationId?: string
  readonly automationRunId?: string
}
```

Inside the handler, replace the hard-coded trigger source and local abort-only behavior:

```ts
const source = options?.triggerSource ?? "mcp"
const ac = new AbortController()
const abortFromOuter = () => ac.abort()
if (options?.abortSignal) {
  if (options.abortSignal.aborted) ac.abort()
  else options.abortSignal.addEventListener("abort", abortFromOuter, { once: true })
}
```

In the existing `const completion = workflowEngine.run` expression, keep the current event callback and rejection handler bodies unchanged. Apply these exact edits to the surrounding call:

```ts
// Replace the current run call suffix:
}, ac.signal, projectId, "mcp").catch((err) => {

// With:
}, ac.signal, projectId, source).catch((err) => {
```

```ts
// Replace the current finally block:
}).finally(() => {
  runCompletions.delete(runId)
})

// With:
}).finally(() => {
  options?.abortSignal?.removeEventListener("abort", abortFromOuter)
  runCompletions.delete(runId)
})
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run workflow regression tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/workflow/components/__tests__/workflow-list.test.tsx desktop/src/modules/workflow/runner/__tests__/workflow-runner-app.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```bash
git add desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts
git commit -m "feat(workflow): expose waitable run helper"
```

---

### Task 3: Main Workflow Executor

**Files:**
- Create: `desktop/action-packages/builtin/workflow/executor.main.ts`
- Create: `desktop/action-packages/builtin/workflow/index.ts`
- Modify: `desktop/electron/action-runtime/builtin-actions.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Test: `desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts`
- Test: `desktop/electron/action-runtime/__tests__/action-registry.test.ts`

- [ ] **Step 1: Write failing executor tests**

Create `desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createWorkflowAction } from "../executor.main"
import type { WorkflowDefinition } from "../../../../src/types/workflow"

const definition: WorkflowDefinition = {
  id: "wf-1",
  name: "每日汇总",
  version: "v1",
  createdAt: 1,
  updatedAt: 2,
  params: [{ name: "topic", type: "text", default: null }],
  nodes: [],
  edges: [],
}

const context = {
  taskId: "auto-1",
  taskName: "自动化",
  runId: "auto-run-1",
  triggeredBy: "manual" as const,
  cwd: "/Users/example/project",
  actor: { kind: "user", id: "automation", display: "Automation" } as const,
  abortSignal: new AbortController().signal,
  templateVariables: { "trigger.request.body.title": "发布总结" },
}

describe("workflow action executor", () => {
  it("requests workflow.run permission", () => {
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(),
      runWorkflowAndWait: vi.fn(),
    })

    expect(action.buildPermissionRequest({
      config: { workflowId: "wf-1", paramTemplates: {} },
      context,
    })).toMatchObject({
      action: "workflow.run",
      resource: "builtin.workflow:wf-1",
      actor: context.actor,
    })
  })

  it("runs workflow with rendered params and maps completed result", async () => {
    const runWorkflowAndWait = vi.fn(async () => ({
      runId: "workflow-run-1",
      definition,
      result: { status: "completed" as const, nodeResults: {}, durationMs: 20, output: "完成" },
    }))
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(async () => definition),
      runWorkflowAndWait,
    })

    const result = await action.execute({
      config: { workflowId: "wf-1", paramTemplates: { topic: "{{trigger.request.body.title}}" } },
      context,
    })

    expect(runWorkflowAndWait).toHaveBeenCalledWith(expect.objectContaining({
      workflowId: "wf-1",
      params: { topic: "发布总结" },
      triggerSource: "automation",
      automationId: "auto-1",
      automationRunId: "auto-run-1",
    }))
    expect(result).toMatchObject({
      status: "success",
      summary: "工作流完成：每日汇总",
      outputs: {
        workflowId: "wf-1",
        workflowName: "每日汇总",
        workflowRunId: "workflow-run-1",
        workflowStatus: "completed",
        output: "完成",
      },
    })
  })

  it("returns failed result when workflow is missing", async () => {
    const action = createWorkflowAction({
      getWorkflowDefinition: vi.fn(async () => null),
      runWorkflowAndWait: vi.fn(),
    })

    await expect(action.execute({
      config: { workflowId: "missing", paramTemplates: {} },
      context,
    })).resolves.toMatchObject({
      status: "failed",
      error: "工作流不存在",
    })
  })
})
```

- [ ] **Step 2: Run executor tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts
```

Expected: FAIL because `executor.main.ts` does not exist.

- [ ] **Step 3: Implement executor**

Create `desktop/action-packages/builtin/workflow/executor.main.ts`:

```ts
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type {
  WorkflowDefinition,
  WorkflowRunResult,
} from "../../../src/types/workflow"
import { workflowActionManifest } from "./manifest"
import {
  buildWorkflowRunParams,
  workflowStatusToActionStatus,
  type WorkflowActionConfig,
} from "./schema"

export interface WorkflowActionRuntimeDeps {
  readonly getWorkflowDefinition: (workflowId: string) => Promise<WorkflowDefinition | null>
  readonly runWorkflowAndWait: (input: {
    readonly workflowId: string
    readonly params: Record<string, unknown>
    readonly abortSignal: AbortSignal
    readonly triggerSource: "automation"
    readonly automationId: string
    readonly automationRunId: string
  }) => Promise<{
    readonly runId: string
    readonly definition: WorkflowDefinition
    readonly result: WorkflowRunResult
  }>
}

export function createWorkflowAction(deps: WorkflowActionRuntimeDeps): MainActionDefinition<WorkflowActionConfig> {
  return {
    manifest: workflowActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "workflow.run",
      actor: context.actor,
      resource: `builtin.workflow:${config.workflowId}`,
      metadata: {
        source: "automation",
        automationId: context.taskId,
        automationRunId: context.runId,
        workflowId: config.workflowId,
      },
    }),
    async execute({ config, context }) {
      const definition = await deps.getWorkflowDefinition(config.workflowId)
      if (!definition) {
        return { status: "failed", summary: "执行失败", error: "工作流不存在" }
      }
      try {
        const params = buildWorkflowRunParams({
          workflowParams: definition.params,
          paramTemplates: config.paramTemplates,
          templateVariables: context.templateVariables,
        })
        const run = await deps.runWorkflowAndWait({
          workflowId: definition.id,
          params,
          abortSignal: context.abortSignal,
          triggerSource: "automation",
          automationId: context.taskId,
          automationRunId: context.runId,
        })
        const status = workflowStatusToActionStatus(run.result.status)
        const label = status === "success" ? "完成" : status === "cancelled" ? "已停止" : "失败"
        return {
          status,
          summary: `工作流${label}：${run.definition.name}`,
          metrics: { durationMs: run.result.durationMs },
          outputs: {
            workflowId: run.definition.id,
            workflowName: run.definition.name,
            workflowRunId: run.runId,
            workflowStatus: run.result.status,
            output: run.result.output,
          },
          error: status === "failed" ? "工作流执行失败" : undefined,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const status = context.abortSignal.aborted ? "cancelled" : "failed"
        return {
          status,
          summary: status === "cancelled" ? `工作流已停止：${definition.name}` : "执行失败",
          error: status === "cancelled" ? "已停止" : message,
        }
      }
    },
  }
}
```

Create `desktop/action-packages/builtin/workflow/index.ts`:

```ts
export { createWorkflowAction } from "./executor.main"
export { workflowActionManifest } from "./manifest"
export {
  buildWorkflowRunParams,
  workflowActionConfigSchema,
  workflowStatusToActionStatus,
  type WorkflowActionConfig,
  type WorkflowActionOutputs,
} from "./schema"
```

- [ ] **Step 4: Run executor tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts
```

Expected: PASS.

- [ ] **Step 5: Register main action with Workflow deps**

Modify `desktop/electron/action-runtime/builtin-actions.ts`:

```ts
import { createWorkflowAction, type WorkflowActionRuntimeDeps } from "../../action-packages/builtin/workflow/executor.main"

export function createBuiltinMainActionRegistry(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly getAgentRuntime?: (projectId: string) => Promise<AgentRuntimeService | undefined>
  readonly workflowRuntime?: WorkflowActionRuntimeDeps
}): MainActionRegistry {
  const registry = new MainActionRegistry()
  registry.register(createCommandAction(deps))
  registry.register(createScriptAction(deps))
  registry.register(createHttpRequestAction())
  if (deps.getAgentRuntime) {
    registry.register(createAgentAction({ getAgentRuntime: deps.getAgentRuntime }))
  }
  if (deps.workflowRuntime) {
    registry.register(createWorkflowAction(deps.workflowRuntime))
  }
  return registry
}
```

Modify `desktop/electron/bootstrap/descriptors.ts` action runtime descriptor:

```ts
dependsOn: [
  "core.process-environment",
  "core.permission-guard",
  "core.audit-sink",
  "core.workflow",
  "core.workflow.engine",
  "core.workflow.snapshots",
  "core.workflow.run-aborts",
  "core.workflow.run-statuses",
],
```

Pass workflow deps:

```ts
const workflowService = ctx.registry.get<WorkflowService>("core.workflow")
const workflowEngine = ctx.registry.get<WorkflowEngine>("core.workflow.engine")
const snapshotService = ctx.registry.get<RunSnapshotService>("core.workflow.snapshots")
const runAborts = ctx.registry.get<Map<string, AbortController>>("core.workflow.run-aborts")
const runStatuses = ctx.registry.get<Map<string, WorkflowRunStatus>>("core.workflow.run-statuses")
const runCompletions = new Map<string, Promise<unknown>>()
const capabilityLogger = createMainLogger("bootstrap.workflow-action")

return createBuiltinMainActionRegistry({
  processRunner: createControlledProcessRunner({ permissionGuard, auditSink }),
  workflowRuntime: {
    getWorkflowDefinition: (workflowId) => workflowService.get(workflowId),
    runWorkflowAndWait: createRunWorkflowAndWait({
      workflowService,
      workflowEngine,
      snapshotService,
      eventBus: ctx.registry.get<EventBus>("core.event-bus"),
      runAborts,
      runStatuses,
      runCompletions,
      capabilityLogger,
    }),
  },
  getAgentRuntime: async (projectId) => {
    const containers = ctx.registry.get<ProjectContainerRegistry>("core.project-containers")
    const existing = containers.peek(projectId)
    if (existing) {
      return existing.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
    }
    const config = await configStore.load()
    const repo = config.repositories.find((r) => r.uuid === projectId)
    const proj = !repo ? config.global.projects.find((p) => p.id === projectId) : undefined
    const meta = repo
      ? { name: repo.name, workspacePath: repo.localPath }
      : proj
        ? { name: proj.name, workspacePath: proj.path }
        : undefined
    if (!meta) return undefined
    const container = await containers.open(projectId, meta)
    return container.get<AgentRuntimeService>(AGENT_RUNTIME_SERVICE_ID)
  },
})
```

- [ ] **Step 6: Update action registry test**

Modify `desktop/electron/action-runtime/__tests__/action-registry.test.ts` to expect `builtin.workflow` when workflow deps are supplied:

```ts
it("registers workflow action when workflow runtime is supplied", () => {
  const registry = createBuiltinMainActionRegistry({
    processRunner: { run: vi.fn() },
    workflowRuntime: {
      getWorkflowDefinition: vi.fn(),
      runWorkflowAndWait: vi.fn(),
    },
  })

  expect(registry.list().map((action) => action.manifest.id)).toContain("builtin.workflow")
})
```

- [ ] **Step 7: Run main action tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts \
  desktop/electron/action-runtime/__tests__/action-registry.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add desktop/action-packages/builtin/workflow/executor.main.ts \
  desktop/action-packages/builtin/workflow/index.ts \
  desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts \
  desktop/electron/action-runtime/builtin-actions.ts \
  desktop/electron/action-runtime/__tests__/action-registry.test.ts \
  desktop/electron/bootstrap/descriptors.ts
git commit -m "feat(automation): run workflows from action runtime"
```

---

### Task 4: Renderer Workflow Config And Registration

**Files:**
- Create: `desktop/action-packages/builtin/workflow/config.renderer.tsx`
- Create: `desktop/action-packages/builtin/workflow/result.renderer.tsx`
- Modify: `desktop/src/action-runtime/builtin-actions.ts`
- Modify: `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx`
- Test: `desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx`
- Test: `desktop/action-packages/builtin/workflow/__tests__/result.renderer.test.tsx`

- [ ] **Step 1: Write failing config renderer tests**

Create `desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx`:

```tsx
import { createRoot } from "react-dom/client"
import { act } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { WorkflowConfigForm } from "../config.renderer"

beforeEach(() => {
  window.synapse = {
    ...(window.synapse ?? {}),
    workflow: {
      ...(window.synapse?.workflow ?? {}),
      list: vi.fn(async () => [
        { id: "wf-1", name: "每日汇总", version: "v1", nodeCount: 2, createdAt: 1, updatedAt: 2 },
      ]),
      get: vi.fn(async () => ({
        id: "wf-1",
        name: "每日汇总",
        version: "v1",
        createdAt: 1,
        updatedAt: 2,
        params: [{ name: "topic", type: "text", default: null, description: "主题" }],
        nodes: [],
        edges: [],
      })),
    },
  } as typeof window.synapse
})

describe("WorkflowConfigForm", () => {
  it("loads workflows and writes workflow id", async () => {
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)
    const onChange = vi.fn()

    await act(async () => {
      root.render(<WorkflowConfigForm value={{ workflowId: "", paramTemplates: {} }} onChange={onChange} />)
    })

    expect(host.textContent).toContain("选择工作流")
    expect(host.textContent).toContain("每日汇总")
  })
})
```

- [ ] **Step 2: Run config renderer test to verify it fails**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx
```

Expected: FAIL because `config.renderer.tsx` does not exist.

- [ ] **Step 3: Implement config renderer**

Create `desktop/action-packages/builtin/workflow/config.renderer.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react"

import {
  Field,
  FieldContent,
  FieldGroup,
  FieldLabel,
} from "../../../src/components/ui/field"
import { Input } from "../../../src/components/ui/input"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../src/components/ui/select"
import { Textarea } from "../../../src/components/ui/textarea"
import type { WorkflowDefinition, WorkflowMeta } from "../../../src/types/workflow"
import type { WorkflowActionConfig } from "./schema"

export function WorkflowConfigForm({
  value,
  onChange,
}: {
  readonly value: WorkflowActionConfig
  readonly onChange: (value: WorkflowActionConfig) => void
}) {
  const [workflows, setWorkflows] = useState<WorkflowMeta[]>([])
  const [definition, setDefinition] = useState<WorkflowDefinition | null>(null)
  const selectedName = useMemo(
    () => workflows.find((workflow) => workflow.id === value.workflowId)?.name,
    [workflows, value.workflowId],
  )

  useEffect(() => {
    let cancelled = false
    window.synapse?.workflow.list().then((items) => {
      if (!cancelled) setWorkflows(items)
    }).catch(() => {
      if (!cancelled) setWorkflows([])
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!value.workflowId) {
      setDefinition(null)
      return () => { cancelled = true }
    }
    window.synapse?.workflow.get(value.workflowId).then((next) => {
      if (!cancelled) setDefinition(next)
    }).catch(() => {
      if (!cancelled) setDefinition(null)
    })
    return () => { cancelled = true }
  }, [value.workflowId])

  return (
    <FieldGroup>
      <Field>
        <FieldLabel htmlFor="automation-workflow-select">选择工作流</FieldLabel>
        <FieldContent>
          <Select
            value={value.workflowId}
            onValueChange={(workflowId) => onChange({
              ...value,
              workflowId,
              paramTemplates: preserveMatchingTemplates(value.paramTemplates, definition),
            })}
          >
            <SelectTrigger id="automation-workflow-select" className="w-full">
              <SelectValue placeholder="选择工作流">{selectedName}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {workflows.map((workflow) => (
                  <SelectItem key={workflow.id} value={workflow.id}>
                    {workflow.name}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </FieldContent>
      </Field>

      {definition && definition.params.length === 0 ? (
        <p className="text-sm text-muted-foreground">无需参数</p>
      ) : null}

      {definition?.params.map((param) => {
        const InputComponent = param.type === "text" ? Textarea : Input
        return (
          <Field key={param.name}>
            <FieldLabel htmlFor={`automation-workflow-param-${param.name}`}>
              {param.description ?? param.name}
            </FieldLabel>
            <FieldContent>
              <InputComponent
                id={`automation-workflow-param-${param.name}`}
                value={value.paramTemplates[param.name] ?? ""}
                onChange={(event) => onChange({
                  ...value,
                  paramTemplates: {
                    ...value.paramTemplates,
                    [param.name]: event.target.value,
                  },
                })}
              />
            </FieldContent>
          </Field>
        )
      })}
    </FieldGroup>
  )
}

function preserveMatchingTemplates(
  current: Record<string, string>,
  definition: WorkflowDefinition | null,
): Record<string, string> {
  if (!definition) return {}
  const names = new Set(definition.params.map((param) => param.name))
  return Object.fromEntries(Object.entries(current).filter(([name]) => names.has(name)))
}
```

- [ ] **Step 4: Register renderer action**

Modify `desktop/src/action-runtime/builtin-actions.ts`:

```ts
import {
  workflowActionManifest,
  type WorkflowActionConfig,
} from "../../action-packages/builtin/workflow"
import { WorkflowConfigForm } from "../../action-packages/builtin/workflow/config.renderer"
import { WorkflowActionResultView } from "../../action-packages/builtin/workflow/result.renderer"

const workflowRendererAction: RendererActionDefinition<WorkflowActionConfig> = {
  manifest: workflowActionManifest,
  summarizeConfig: (config) => `工作流 · ${config.workflowId || "未选择"}`,
  ConfigForm: WorkflowConfigForm,
  ResultView: WorkflowActionResultView,
}

rendererActionRegistry.register(workflowRendererAction)
```

- [ ] **Step 5: Write result renderer tests**

Create `desktop/action-packages/builtin/workflow/__tests__/result.renderer.test.tsx`:

```tsx
import { createRoot } from "react-dom/client"
import { act } from "react"
import { describe, expect, it, vi } from "vitest"
import { WorkflowActionResultView } from "../result.renderer"

describe("WorkflowActionResultView", () => {
  it("opens workflow runner for workflow outputs", async () => {
    const openRunner = vi.fn(async () => undefined)
    window.synapse = {
      ...(window.synapse ?? {}),
      workflow: { ...(window.synapse?.workflow ?? {}), openRunner },
    } as typeof window.synapse
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<WorkflowActionResultView result={{
        status: "success",
        summary: "工作流完成：每日汇总",
        outputs: {
          workflowId: "wf-1",
          workflowName: "每日汇总",
          workflowRunId: "run-1",
          workflowStatus: "completed",
          output: "done",
        },
      }} />)
    })

    const button = host.querySelector("button")
    expect(button?.textContent).toContain("打开运行记录")
    await act(async () => button?.dispatchEvent(new MouseEvent("click", { bubbles: true })))
    expect(openRunner).toHaveBeenCalledWith("wf-1", "run-1")
  })
})
```

- [ ] **Step 6: Implement result renderer**

Create `desktop/action-packages/builtin/workflow/result.renderer.tsx`:

```tsx
import type { ActionRunResult } from "../../types"
import { Button } from "../../../src/components/ui/button"
import { ActionResultView } from "../../../src/action-runtime/action-result-view"
import type { WorkflowActionOutputs } from "./schema"

export function WorkflowActionResultView({ result }: { readonly result: ActionRunResult }) {
  const outputs = result.outputs as WorkflowActionOutputs | undefined
  if (!outputs?.workflowId || !outputs.workflowRunId) return <ActionResultView result={result} />

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionResultView result={result} />
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground truncate">{outputs.workflowName}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            void window.synapse?.workflow.openRunner(outputs.workflowId, outputs.workflowRunId)
          }}
        >
          打开运行记录
        </Button>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Update Automation editor test**

Modify `desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx` to assert the executor list includes `工作流`:

```tsx
expect(screen.getByRole("button", { name: /工作流/ })).toBeInTheDocument()
```

If the test environment lacks workflow bridge mocks, add:

```ts
workflow: {
  list: vi.fn(async () => []),
  get: vi.fn(async () => null),
}
```

- [ ] **Step 8: Run renderer tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx \
  desktop/action-packages/builtin/workflow/__tests__/result.renderer.test.tsx \
  desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx \
  desktop/src/action-runtime/__tests__/action-registry.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit Task 4**

Run:

```bash
git add desktop/action-packages/builtin/workflow/config.renderer.tsx \
  desktop/action-packages/builtin/workflow/result.renderer.tsx \
  desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx \
  desktop/action-packages/builtin/workflow/__tests__/result.renderer.test.tsx \
  desktop/src/action-runtime/builtin-actions.ts \
  desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx
git commit -m "feat(automation): add workflow executor UI"
```

---

### Task 5: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Append one user-facing bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 自动化动作新增“工作流”，现在可以用 Cron、固定间隔或 Webhook 触发已保存工作流，并把触发数据传入工作流参数。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop test -- \
  desktop/action-packages/builtin/workflow/__tests__/schema.test.ts \
  desktop/action-packages/builtin/workflow/__tests__/manifest.test.ts \
  desktop/action-packages/builtin/workflow/__tests__/executor.main.test.ts \
  desktop/action-packages/builtin/workflow/__tests__/config.renderer.test.tsx \
  desktop/action-packages/builtin/workflow/__tests__/result.renderer.test.tsx \
  desktop/electron/bootstrap/__tests__/workflow-runner-helper.test.ts \
  desktop/electron/action-runtime/__tests__/action-registry.test.ts \
  desktop/src/action-runtime/__tests__/action-registry.test.tsx \
  desktop/src/modules/automation/editor/__tests__/editor-app.test.tsx
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

- [ ] **Step 4: Run TypeScript or package tests if focused suite passes**

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 5: Inspect git diff for UI rule violations**

Run:

```bash
git diff --check
rg -n "style=\\{|#[0-9a-fA-F]{3,8}|rgb\\(|hsl\\(|bg-\\[|text-\\[|gradient|glow|console\\.log" \
  desktop/action-packages/builtin/workflow desktop/src/action-runtime/builtin-actions.ts
```

Expected: `git diff --check` exits 0. The `rg` command should return no UI style/color/log violations in the new Workflow action files.

- [ ] **Step 6: Commit Task 5**

Run:

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note automation workflow executor"
```

---

## Self-Review

Spec coverage:

- Right-side `工作流` executor: Tasks 1, 3, and 4.
- One trigger plus one executor model: Task 4 only registers a normal Action Runtime executor and does not modify Automation item shape.
- Workflow param templates: Tasks 1 and 4.
- Waitable Workflow run, cancellation, and result mapping: Tasks 2 and 3.
- No automatic Runner window, history opens Runner by user action: Task 4 result renderer.
- Permission and logging boundaries: Task 3 permission request and Task 5 focused violation scan.
- Release note: Task 5.

Placeholder scan:

- The plan contains no `TBD`, `TODO`, `implement later`, or "similar to" steps.
- Every code-changing step includes a concrete code block or exact command.

Type consistency:

- `WorkflowActionConfig`, `WorkflowActionOutputs`, `createWorkflowAction`, `WorkflowConfigForm`, and `WorkflowActionResultView` names are consistent across tasks.
- Runtime dependency names are `getWorkflowDefinition` and `runWorkflowAndWait` in both the executor and bootstrap registration.
