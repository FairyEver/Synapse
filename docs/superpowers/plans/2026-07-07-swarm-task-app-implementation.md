# Swarm Task App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the "蜂群任务" system app as a full Synapse app capability for reusable multi-Agent prompt runs.

**Architecture:** Add `desktop/app-capabilities/swarm-task/` with shared schemas, main service, scheduler, prompt builder, renderer UI, MCP dispatcher, and Workflow node. The service stores reusable tasks and run snapshots in DataRepository, starts fresh Synapse Agent Runtime side sessions for each worker round, and tracks high-level worker status while full output stays in linked Agent conversations.

**Tech Stack:** Electron 41, React 19, TypeScript 6, zod, shadcn/ui, Tailwind CSS 4, Synapse DataRepository, Synapse Agent Runtime, Synapse Workflow node registry, Synapse capability dispatcher.

## Global Constraints

- Do not spawn CLI workers from the desktop app.
- Do not implement a terminal monitor or terminal grid.
- Do not classify user prompts as research, fix, implementation, or writing tasks.
- Do not pass full prior worker output into later prompts.
- Use existing shadcn/Tailwind tokens and shared layout components.
- No custom colors, decorative gradients, nested cards, or explanatory marketing copy.
- Store app data under DataRepository namespaces `app.swarm-task.tasks`, `app.swarm-task.runs`, and `app.swarm-task.worker-runs`.
- Worker conversations use `platform: "swarm"` and `sessionKey: "swarm:<taskId>:<runId>"`.
- Summary defaults to enabled; Handoff defaults to disabled.
- Every run stores a full config snapshot.

---

## File Structure

Create:

- `desktop/app-capabilities/swarm-task/shared/capability.ts`: stable app id, capability ids, MCP tool names, workflow node type.
- `desktop/app-capabilities/swarm-task/shared/schema.ts`: zod schemas and TypeScript types for task config, tasks, runs, worker runs, IPC inputs, MCP inputs, and event payloads.
- `desktop/app-capabilities/swarm-task/shared/prompt.ts`: shared prompt section constants and Summary/Handoff delimiter constants.
- `desktop/electron/runtime/data-repo/schemas/swarm-task.ts`: DataRepository namespace schemas and entry types.
- `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`: pure prompt assembly and Summary/Handoff parsing.
- `desktop/app-capabilities/swarm-task/main/scheduler.ts`: fixed batch and continuous refill scheduling with a dependency-injected worker runner.
- `desktop/app-capabilities/swarm-task/main/service.ts`: task CRUD, run lifecycle, Agent Runtime integration, worker event tracking, stop/cancel.
- `desktop/app-capabilities/swarm-task/main/ipc.ts`: renderer IPC module.
- `desktop/app-capabilities/swarm-task/main/dispatcher.ts`: MCP dispatcher.
- `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`: prompt and parsing tests.
- `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`: scheduler tests.
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`: service tests with fake repositories and fake Agent gateway.
- `desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts`: IPC routing tests.
- `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`: MCP dispatcher tests.
- `desktop/app-capabilities/swarm-task/renderer/app-definition.ts`: system app definition.
- `desktop/app-capabilities/swarm-task/renderer/app-manifest.ts`: system app manifest.
- `desktop/app-capabilities/swarm-task/renderer/index.tsx`: app shell and data hooks.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-sidebar.tsx`: task list and search.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx`: selected task detail and tabs.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`: task configuration form.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-run-panel.tsx`: running worker table.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-run-history.tsx`: historical run table.
- `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`: renderer behavior tests.
- `desktop/app-capabilities/swarm-task/workflow-node/schema.ts`: workflow node config schema.
- `desktop/app-capabilities/swarm-task/workflow-node/manifest.ts`: workflow node manifest.
- `desktop/app-capabilities/swarm-task/workflow-node/executor.main.ts`: workflow node executor.
- `desktop/app-capabilities/swarm-task/workflow-node/panel.tsx`: workflow node config panel.
- `desktop/app-capabilities/swarm-task/workflow-node/card.tsx`: workflow node card.
- `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`: workflow schema tests.
- `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`: workflow executor tests.

Modify:

- `desktop/electron/runtime/data-repo/schemas/index.ts`: export and register Swarm Task schemas.
- `desktop/electron/bootstrap/descriptors.ts`: register `core.swarm-task` service descriptor.
- `desktop/electron/bootstrap/ipc-registry.ts`: register Swarm Task IPC module.
- `desktop/electron/preload.ts`: add `swarmTask` bridge channels and methods.
- `desktop/src/types/agent-navigation.ts`: add `swarm` platform and source filter.
- `desktop/src/modules/agent/conversation-source.ts`: classify `platform: "swarm"`.
- `desktop/electron/modules/agent/ipc-sessions.ts`: allow `platform: "swarm"` for open conversation requests.
- `desktop/src/modules/apps/types.ts`: include the `swarm-task` system app id where app ids are enumerated.
- `desktop/src/modules/apps/registry.ts`: register Swarm Task app manifest.
- `desktop/workflow-nodes/register.main.ts`: register Swarm Task workflow executor.
- `desktop/workflow-nodes/register.renderer.ts`: register Swarm Task workflow manifest.
- `desktop/workflow-nodes/panel-registry.ts`: register Swarm Task workflow panel.
- `desktop/app-capabilities/dispatcher.ts`: route `app.swarm_task.*` capabilities.
- `desktop/electron/bootstrap/registry.ts`: register the Swarm Task core service descriptor.
- `desktop/resources/templates/skills/synapse-skill/files/automation/index.md`: add Swarm Task MCP capability overview.
- `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`: add Swarm Task MCP tool reference.
- `RELEASE_NOTES_PENDING.md`: add a user-facing note for the new app.

Do not modify `templates/`.

---

### Task 1: Shared Schemas And DataRepository Entries

**Files:**
- Create: `desktop/app-capabilities/swarm-task/shared/capability.ts`
- Create: `desktop/app-capabilities/swarm-task/shared/prompt.ts`
- Create: `desktop/app-capabilities/swarm-task/shared/schema.ts`
- Create: `desktop/electron/runtime/data-repo/schemas/swarm-task.ts`
- Modify: `desktop/electron/runtime/data-repo/schemas/index.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`

**Interfaces:**
- Produces: `SWARM_TASK_APP_ID`, `SWARM_TASK_SERVICE_ID`, `SWARM_TASK_MCP_TOOL_NAMES`, `SWARM_TASK_WORKFLOW_NODE_TYPE`.
- Produces: `swarmTaskConfigSchema`, `swarmTaskSchema`, `swarmRunSchema`, `swarmWorkerRunSchema`, `swarmTaskCreateInputSchema`, `swarmTaskUpdateInputSchema`, `swarmRunStartInputSchema`.
- Produces: `SWARM_TASKS_NAMESPACE`, `SWARM_TASK_RUNS_NAMESPACE`, `SWARM_TASK_WORKER_RUNS_NAMESPACE`.
- Produces types: `SwarmTaskConfig`, `SwarmTask`, `SwarmRun`, `SwarmWorkerRun`, `SwarmRunStatus`, `SwarmWorkerRunStatus`.

- [ ] **Step 1: Write failing schema tests**

Create `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  swarmTaskRunsSchemaDefinition,
  swarmTaskTasksSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
} from "../schemas/swarm-task"
import { allSchemas } from "../schemas"

const baseConfig = {
  projectId: "project-1",
  workspacePath: "/Users/liyang/Documents/code/github/Synapse",
  prompt: "Run the task.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  output: {
    mode: "managed-directory",
    targetFilePolicy: "append-only",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 3,
  },
  handoff: {
    enabled: false,
  },
  agent: {
    providerId: "provider-1",
    modelTier: "default",
    permissionMode: "default",
    mainThreadPersonaId: null,
  },
}

describe("swarm task DataRepository schemas", () => {
  it("registers task, run, and worker namespaces", () => {
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.tasks")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.runs")
    expect(allSchemas.map((schema) => schema.name)).toContain("app.swarm-task.worker-runs")
  })

  it("validates a task entry", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "巡检",
      description: "",
      currentConfig: baseConfig,
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      lastRunId: "run-1",
      lastStatus: "success",
    }

    expect(swarmTaskTasksSchemaDefinition.validate(entry)).toEqual(entry)
  })

  it("validates a run snapshot", () => {
    const entry = {
      id: "run-1",
      schemaVersion: 1,
      taskId: "task-1",
      status: "running",
      configSnapshot: baseConfig,
      startedAt: "2026-07-07T00:00:00.000Z",
      totals: { started: 1, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: "/tmp/swarm-runs/run-1",
      stopRequested: false,
    }

    expect(swarmTaskRunsSchemaDefinition.validate(entry)).toEqual(entry)
  })

  it("validates a worker run", () => {
    const entry = {
      id: "worker-1",
      schemaVersion: 1,
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      status: "running",
      conversationId: "conversation-1",
      sessionKey: "swarm:task-1:run-1",
      startedAt: "2026-07-07T00:00:00.000Z",
      lastPhase: "thinking",
      lastMessage: "思考",
    }

    expect(swarmTaskWorkerRunsSchemaDefinition.validate(entry)).toEqual(entry)
  })

  it("rejects invalid output policies", () => {
    const entry = {
      id: "task-1",
      schemaVersion: 1,
      name: "bad",
      currentConfig: {
        ...baseConfig,
        output: { mode: "target-file", targetFilePolicy: "overwrite" },
      },
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
    }

    expect(() => swarmTaskTasksSchemaDefinition.validate(entry)).toThrow()
  })
})
```

- [ ] **Step 2: Run schema tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`

Expected: FAIL because `../schemas/swarm-task` does not exist.

- [ ] **Step 3: Add shared capability constants**

Create `desktop/app-capabilities/swarm-task/shared/capability.ts`:

```ts
import type { CapabilityId } from "../../../synapse-capabilities/shared/naming"

export const SWARM_TASK_APP_ID = "swarm-task" as const
export const SWARM_TASK_SERVICE_ID = "core.swarm-task" as const
export const SWARM_TASK_WORKFLOW_NODE_TYPE = "swarm_task_run" as const

export const SWARM_TASK_TASK_CREATE_CAPABILITY_ID =
  "app.swarm_task.task.create" as CapabilityId
export const SWARM_TASK_TASK_LIST_CAPABILITY_ID =
  "app.swarm_task.task.list" as CapabilityId
export const SWARM_TASK_TASK_GET_CAPABILITY_ID =
  "app.swarm_task.task.get" as CapabilityId
export const SWARM_TASK_TASK_UPDATE_CAPABILITY_ID =
  "app.swarm_task.task.update" as CapabilityId
export const SWARM_TASK_TASK_DELETE_CAPABILITY_ID =
  "app.swarm_task.task.delete" as CapabilityId
export const SWARM_TASK_RUN_START_CAPABILITY_ID =
  "app.swarm_task.run.start" as CapabilityId
export const SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID =
  "app.swarm_task.run.stopRefill" as CapabilityId
export const SWARM_TASK_RUN_CANCEL_CAPABILITY_ID =
  "app.swarm_task.run.cancel" as CapabilityId
export const SWARM_TASK_RUN_LIST_CAPABILITY_ID =
  "app.swarm_task.run.list" as CapabilityId
export const SWARM_TASK_RUN_GET_CAPABILITY_ID =
  "app.swarm_task.run.get" as CapabilityId

export const SWARM_TASK_CAPABILITY_IDS = [
  SWARM_TASK_TASK_CREATE_CAPABILITY_ID,
  SWARM_TASK_TASK_LIST_CAPABILITY_ID,
  SWARM_TASK_TASK_GET_CAPABILITY_ID,
  SWARM_TASK_TASK_UPDATE_CAPABILITY_ID,
  SWARM_TASK_TASK_DELETE_CAPABILITY_ID,
  SWARM_TASK_RUN_START_CAPABILITY_ID,
  SWARM_TASK_RUN_STOP_REFILL_CAPABILITY_ID,
  SWARM_TASK_RUN_CANCEL_CAPABILITY_ID,
  SWARM_TASK_RUN_LIST_CAPABILITY_ID,
  SWARM_TASK_RUN_GET_CAPABILITY_ID,
] as const

export const SWARM_TASK_MCP_TOOL_NAMES = {
  taskCreate: "app_swarm_task_task_create",
  taskList: "app_swarm_task_task_list",
  taskGet: "app_swarm_task_task_get",
  taskUpdate: "app_swarm_task_task_update",
  taskDelete: "app_swarm_task_task_delete",
  runStart: "app_swarm_task_run_start",
  runStopRefill: "app_swarm_task_run_stopRefill",
  runCancel: "app_swarm_task_run_cancel",
  runList: "app_swarm_task_run_list",
  runGet: "app_swarm_task_run_get",
} as const
```

- [ ] **Step 4: Add shared prompt constants**

Create `desktop/app-capabilities/swarm-task/shared/prompt.ts`:

```ts
export const SWARM_SUMMARY_OPEN = "<SYNAPSE_SWARM_SUMMARY>" as const
export const SWARM_SUMMARY_CLOSE = "</SYNAPSE_SWARM_SUMMARY>" as const
export const SWARM_HANDOFF_OPEN = "<SYNAPSE_SWARM_HANDOFF>" as const
export const SWARM_HANDOFF_CLOSE = "</SYNAPSE_SWARM_HANDOFF>" as const
```

- [ ] **Step 5: Add shared zod schemas**

Create `desktop/app-capabilities/swarm-task/shared/schema.ts`:

```ts
import { z } from "zod"

export const swarmRunModeSchema = z.enum(["batch", "continuous"])
export const swarmOutputModeSchema = z.enum(["managed-directory", "target-file", "both"])
export const swarmTargetFilePolicySchema = z.enum(["append-only", "section-update", "free-edit"])
export const swarmRunStatusSchema = z.enum(["running", "draining", "success", "partial", "failed", "cancelled"])
export const swarmWorkerRunStatusSchema = z.enum(["queued", "running", "success", "failed", "cancelled", "timeout"])
export const swarmWorkerPhaseSchema = z.enum([
  "queued",
  "thinking",
  "reading",
  "writing",
  "command",
  "permission",
  "completed",
  "failed",
])

export const swarmInjectOptionsSchema = z.object({
  workerIdentity: z.boolean().default(true),
  roundContext: z.boolean().default(true),
  runContext: z.boolean().default(true),
  outputProtocol: z.boolean().default(true),
  parallelContext: z.boolean().default(true),
  gitContext: z.boolean().default(false),
  customAppendix: z.string().max(16 * 1024).optional().default(""),
}).strict()

export const swarmOutputConfigSchema = z.object({
  mode: swarmOutputModeSchema.default("managed-directory"),
  managedDirectory: z.string().min(1).optional(),
  targetFile: z.string().min(1).optional(),
  targetFilePolicy: swarmTargetFilePolicySchema.default("append-only"),
}).strict()

export const swarmSummaryConfigSchema = z.object({
  enabled: z.boolean().default(true),
  injectRecent: z.boolean().default(false),
  recentLimit: z.number().int().min(1).max(20).default(3),
}).strict()

export const swarmHandoffConfigSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmAgentConfigSchema = z.object({
  providerId: z.string().min(1).optional(),
  modelTier: z.string().min(1).optional(),
  permissionMode: z.string().min(1).optional(),
  mainThreadPersonaId: z.string().min(1).nullable().optional(),
}).strict()

export const swarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  workspacePath: z.string().min(1),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: swarmInjectOptionsSchema.default({}),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  output: swarmOutputConfigSchema.default({}),
  summary: swarmSummaryConfigSchema.default({}),
  handoff: swarmHandoffConfigSchema.default({}),
  agent: swarmAgentConfigSchema.default({}),
}).strict()

export const swarmRunTotalsSchema = z.object({
  started: z.number().int().min(0),
  success: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  timeout: z.number().int().min(0),
}).strict()

export const swarmTaskSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  name: z.string().min(1).max(120),
  description: z.string().max(4096).optional(),
  currentConfig: swarmTaskConfigSchema,
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  lastRunId: z.string().min(1).optional(),
  lastStatus: swarmRunStatusSchema.optional(),
}).strict()

export const swarmRunSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  status: swarmRunStatusSchema,
  configSnapshot: swarmTaskConfigSchema,
  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).optional(),
  totals: swarmRunTotalsSchema,
  outputDirectory: z.string().min(1).optional(),
  stopRequested: z.boolean(),
}).strict()

export const swarmWorkerRunSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(1),
  taskId: z.string().min(1),
  runId: z.string().min(1),
  workerIndex: z.number().int().min(1),
  roundIndex: z.number().int().min(1),
  status: swarmWorkerRunStatusSchema,
  conversationId: z.string().min(1).optional(),
  sessionKey: z.string().min(1),
  startedAt: z.string().min(1).optional(),
  finishedAt: z.string().min(1).optional(),
  lastPhase: swarmWorkerPhaseSchema.optional(),
  lastMessage: z.string().max(2000).optional(),
  summary: z.string().max(64 * 1024).optional(),
  summaryFallback: z.boolean().optional(),
  handoff: z.string().max(64 * 1024).optional(),
  error: z.string().max(4000).optional(),
}).strict()

export const swarmTaskCreateInputSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(4096).optional(),
  config: swarmTaskConfigSchema,
}).strict()

export const swarmTaskUpdateInputSchema = z.object({
  taskId: z.string().min(1),
  patch: z.object({
    name: z.string().min(1).max(120).optional(),
    description: z.string().max(4096).optional(),
    currentConfig: swarmTaskConfigSchema.optional(),
  }).strict(),
}).strict()

export const swarmTaskIdInputSchema = z.object({
  taskId: z.string().min(1),
}).strict()

export const swarmRunIdInputSchema = z.object({
  runId: z.string().min(1),
}).strict()

export const swarmRunStartInputSchema = z.object({
  taskId: z.string().min(1),
  configOverride: swarmTaskConfigSchema.partial().optional(),
}).strict()

export const swarmRunListInputSchema = z.object({
  taskId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict()

export const swarmTaskListResultSchema = z.array(swarmTaskSchema)
export const swarmRunListResultSchema = z.array(swarmRunSchema)
export const swarmWorkerRunListResultSchema = z.array(swarmWorkerRunSchema)

export type SwarmRunMode = z.infer<typeof swarmRunModeSchema>
export type SwarmRunStatus = z.infer<typeof swarmRunStatusSchema>
export type SwarmWorkerRunStatus = z.infer<typeof swarmWorkerRunStatusSchema>
export type SwarmWorkerPhase = z.infer<typeof swarmWorkerPhaseSchema>
export type SwarmTaskConfig = z.infer<typeof swarmTaskConfigSchema>
export type SwarmTask = z.infer<typeof swarmTaskSchema>
export type SwarmRun = z.infer<typeof swarmRunSchema>
export type SwarmWorkerRun = z.infer<typeof swarmWorkerRunSchema>
export type SwarmTaskCreateInput = z.infer<typeof swarmTaskCreateInputSchema>
export type SwarmTaskUpdateInput = z.infer<typeof swarmTaskUpdateInputSchema>
export type SwarmRunStartInput = z.infer<typeof swarmRunStartInputSchema>
export type SwarmRunListInput = z.infer<typeof swarmRunListInputSchema>
```

- [ ] **Step 6: Add DataRepository namespace schemas**

Create `desktop/electron/runtime/data-repo/schemas/swarm-task.ts`:

```ts
import type { NamespaceSchema } from "../types"
import {
  swarmRunSchema,
  swarmTaskSchema,
  swarmWorkerRunSchema,
  type SwarmRun,
  type SwarmTask,
  type SwarmWorkerRun,
} from "../../../../app-capabilities/swarm-task/shared/schema"

export const SWARM_TASKS_NAMESPACE = "app.swarm-task.tasks" as const
export const SWARM_TASK_RUNS_NAMESPACE = "app.swarm-task.runs" as const
export const SWARM_TASK_WORKER_RUNS_NAMESPACE = "app.swarm-task.worker-runs" as const

export type SwarmTaskEntryV1 = SwarmTask
export type SwarmRunEntryV1 = SwarmRun
export type SwarmWorkerRunEntryV1 = SwarmWorkerRun

export const swarmTaskTasksSchemaDefinition: NamespaceSchema<SwarmTaskEntryV1> = {
  name: SWARM_TASKS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmTaskSchema.parse(value)
  },
}

export const swarmTaskRunsSchemaDefinition: NamespaceSchema<SwarmRunEntryV1> = {
  name: SWARM_TASK_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmRunSchema.parse(value)
  },
}

export const swarmTaskWorkerRunsSchemaDefinition: NamespaceSchema<SwarmWorkerRunEntryV1> = {
  name: SWARM_TASK_WORKER_RUNS_NAMESPACE,
  currentVersion: 1,
  backend: "sqlite",
  validate(value: unknown) {
    return swarmWorkerRunSchema.parse(value)
  },
}
```

- [ ] **Step 7: Register schemas**

Modify `desktop/electron/runtime/data-repo/schemas/index.ts`:

```ts
export {
  SWARM_TASKS_NAMESPACE,
  SWARM_TASK_RUNS_NAMESPACE,
  SWARM_TASK_WORKER_RUNS_NAMESPACE,
  swarmTaskRunsSchemaDefinition,
  swarmTaskTasksSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
  type SwarmRunEntryV1,
  type SwarmTaskEntryV1,
  type SwarmWorkerRunEntryV1,
} from "./swarm-task"
```

Add imports near other schema imports:

```ts
import {
  swarmTaskRunsSchemaDefinition,
  swarmTaskTasksSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
} from "./swarm-task"
```

Add to `allSchemas` after `agentPersonaRemoteCacheSchema`:

```ts
  swarmTaskTasksSchemaDefinition,
  swarmTaskRunsSchemaDefinition,
  swarmTaskWorkerRunsSchemaDefinition,
```

- [ ] **Step 8: Run schema tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/app-capabilities/swarm-task/shared desktop/electron/runtime/data-repo/schemas desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
git commit -m "feat: add swarm task schemas"
```

---

### Task 2: Prompt Builder And Summary/Handoff Parsing

**Files:**
- Create: `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`
- Create: `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `SwarmTaskConfig`, `SwarmWorkerRun`, `SWARM_SUMMARY_OPEN`, `SWARM_SUMMARY_CLOSE`, `SWARM_HANDOFF_OPEN`, `SWARM_HANDOFF_CLOSE`.
- Produces: `buildSwarmWorkerPrompt(input: BuildSwarmWorkerPromptInput): string`.
- Produces: `extractSwarmStructuredOutput(text: string): ExtractedSwarmOutput`.
- Produces: `fallbackSummary(text: string, maxLength?: number): string`.

- [ ] **Step 1: Write failing prompt builder tests**

Create `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import {
  buildSwarmWorkerPrompt,
  extractSwarmStructuredOutput,
  fallbackSummary,
} from "../prompt-builder"
import type { SwarmTaskConfig, SwarmWorkerRun } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  workspacePath: "/repo",
  prompt: "检查当前模块并处理一个真实问题。",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: true,
    customAppendix: "额外规则：保持改动很小。",
  },
  runMode: "continuous",
  concurrency: 4,
  maxRounds: 8,
  output: {
    mode: "both",
    managedDirectory: "/repo/swarm-runs/run-1",
    targetFile: "/repo/report.md",
    targetFilePolicy: "append-only",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 2,
  },
  handoff: {
    enabled: true,
  },
  agent: {},
}

const recentSummaries: SwarmWorkerRun[] = [
  {
    id: "worker-1",
    schemaVersion: 1,
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    status: "success",
    sessionKey: "swarm:task-1:run-1",
    summary: "第一轮确认入口文件。",
  },
  {
    id: "worker-2",
    schemaVersion: 1,
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 2,
    roundIndex: 2,
    status: "success",
    sessionKey: "swarm:task-1:run-1",
    summary: "第二轮补了测试。",
  },
]

describe("buildSwarmWorkerPrompt", () => {
  it("builds prompt sections in a stable order", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 3,
      roundIndex: 3,
      config,
      recentSummaries,
      previousHandoff: "下一轮继续看 service.ts。",
    })

    expect(prompt.indexOf("## Swarm Runtime Context")).toBeLessThan(prompt.indexOf("## Recent Summaries"))
    expect(prompt.indexOf("## Recent Summaries")).toBeLessThan(prompt.indexOf("## Previous Handoff"))
    expect(prompt.indexOf("## Previous Handoff")).toBeLessThan(prompt.indexOf("## Output Protocol"))
    expect(prompt.indexOf("## User Prompt")).toBeLessThan(prompt.indexOf("## Structured Ending Protocol"))
    expect(prompt).toContain("Worker: 3/4")
    expect(prompt).toContain("Round: 3")
    expect(prompt).toContain("Run mode: continuous")
    expect(prompt).toContain("/repo/swarm-runs/run-1")
    expect(prompt).toContain("/repo/report.md")
    expect(prompt).toContain("Write policy: append-only")
    expect(prompt).toContain("第一轮确认入口文件。")
    expect(prompt).toContain("第二轮补了测试。")
    expect(prompt).toContain("下一轮继续看 service.ts。")
    expect(prompt).toContain("检查当前模块并处理一个真实问题。")
    expect(prompt).toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).toContain("<SYNAPSE_SWARM_HANDOFF>")
  })

  it("omits disabled summary and handoff sections", () => {
    const prompt = buildSwarmWorkerPrompt({
      taskId: "task-1",
      runId: "run-1",
      workerIndex: 1,
      roundIndex: 1,
      config: {
        ...config,
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        handoff: { enabled: false },
      },
      recentSummaries,
      previousHandoff: "ignored",
    })

    expect(prompt).not.toContain("## Recent Summaries")
    expect(prompt).not.toContain("## Previous Handoff")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_SUMMARY>")
    expect(prompt).not.toContain("<SYNAPSE_SWARM_HANDOFF>")
  })
})

describe("extractSwarmStructuredOutput", () => {
  it("extracts summary and handoff blocks", () => {
    const result = extractSwarmStructuredOutput([
      "normal output",
      "<SYNAPSE_SWARM_SUMMARY>",
      "本轮完成测试。",
      "</SYNAPSE_SWARM_SUMMARY>",
      "<SYNAPSE_SWARM_HANDOFF>",
      "下一轮看 UI。",
      "</SYNAPSE_SWARM_HANDOFF>",
    ].join("\n"))

    expect(result.summary).toBe("本轮完成测试。")
    expect(result.handoff).toBe("下一轮看 UI。")
  })

  it("returns undefined values when blocks are missing", () => {
    expect(extractSwarmStructuredOutput("plain result")).toEqual({})
  })
})

describe("fallbackSummary", () => {
  it("trims long final output", () => {
    expect(fallbackSummary("a".repeat(20), 8)).toBe("aaaaaaaa")
  })
})
```

- [ ] **Step 2: Run prompt tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`

Expected: FAIL because `prompt-builder.ts` does not exist.

- [ ] **Step 3: Implement prompt builder**

Create `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`:

```ts
import type { SwarmTaskConfig, SwarmWorkerRun } from "../shared/schema"
import {
  SWARM_HANDOFF_CLOSE,
  SWARM_HANDOFF_OPEN,
  SWARM_SUMMARY_CLOSE,
  SWARM_SUMMARY_OPEN,
} from "../shared/prompt"

export type BuildSwarmWorkerPromptInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly config: SwarmTaskConfig
  readonly recentSummaries: readonly SwarmWorkerRun[]
  readonly previousHandoff?: string
}

export type ExtractedSwarmOutput = {
  readonly summary?: string
  readonly handoff?: string
}

export function buildSwarmWorkerPrompt(input: BuildSwarmWorkerPromptInput): string {
  const sections: string[] = []
  const inject = input.config.injectOptions

  sections.push(runtimeContextSection(input))

  if (input.config.summary.enabled && input.config.summary.injectRecent) {
    const summaries = input.recentSummaries
      .filter((item) => item.summary?.trim())
      .slice(-input.config.summary.recentLimit)
    if (summaries.length > 0) {
      sections.push([
        "## Recent Summaries",
        ...summaries.map((item) =>
          `- Worker ${item.workerIndex}, round ${item.roundIndex}: ${item.summary?.trim()}`),
      ].join("\n"))
    }
  }

  if (input.config.handoff.enabled && input.previousHandoff?.trim()) {
    sections.push([
      "## Previous Handoff",
      input.previousHandoff.trim(),
    ].join("\n"))
  }

  if (inject.outputProtocol) {
    sections.push(outputProtocolSection(input.config))
  }

  if (inject.parallelContext || inject.gitContext || inject.customAppendix?.trim()) {
    sections.push(parallelContextSection(input.config))
  }

  sections.push([
    "## User Prompt",
    input.config.prompt,
  ].join("\n"))

  const ending = structuredEndingSection(input.config)
  if (ending) sections.push(ending)

  return sections.filter(Boolean).join("\n\n")
}

function runtimeContextSection(input: BuildSwarmWorkerPromptInput): string {
  return [
    "## Swarm Runtime Context",
    `Task: ${input.taskId}`,
    `Run: ${input.runId}`,
    `Worker: ${input.workerIndex}/${input.config.concurrency}`,
    `Round: ${input.roundIndex}`,
    `Run mode: ${input.config.runMode}`,
    `Workspace: ${input.config.workspacePath}`,
  ].join("\n")
}

function outputProtocolSection(config: SwarmTaskConfig): string {
  const lines = [
    "## Output Protocol",
    `Output mode: ${config.output.mode}`,
    `Write policy: ${config.output.targetFilePolicy}`,
  ]
  if (config.output.managedDirectory) {
    lines.push(`Managed output directory: ${config.output.managedDirectory}`)
  }
  if (config.output.targetFile) {
    lines.push(`Target file: ${config.output.targetFile}`)
  }
  lines.push("If the user asks you to write output files, follow the output mode and write policy above.")
  return lines.join("\n")
}

function parallelContextSection(config: SwarmTaskConfig): string {
  const lines = ["## Parallel Coordination"]
  if (config.injectOptions.parallelContext) {
    lines.push("- Multiple workers may run in the same workspace. Avoid overwriting unrelated user or worker changes.")
  }
  if (config.injectOptions.gitContext) {
    lines.push("- If you use git, inspect git status and git diff before staging. Do not use git add .")
  }
  const custom = config.injectOptions.customAppendix?.trim()
  if (custom) lines.push(custom)
  return lines.join("\n")
}

function structuredEndingSection(config: SwarmTaskConfig): string {
  const lines = ["## Structured Ending Protocol"]
  if (config.summary.enabled) {
    lines.push(
      "End with a concise Summary block:",
      SWARM_SUMMARY_OPEN,
      "本轮完成的工作、产出、风险和建议。",
      SWARM_SUMMARY_CLOSE,
    )
  }
  if (config.handoff.enabled) {
    lines.push(
      "End with a Handoff block for the next worker round:",
      SWARM_HANDOFF_OPEN,
      "给下一轮 worker 的接续信息。",
      SWARM_HANDOFF_CLOSE,
    )
  }
  return lines.length > 1 ? lines.join("\n") : ""
}

export function extractSwarmStructuredOutput(text: string): ExtractedSwarmOutput {
  return {
    ...extractBlock(text, SWARM_SUMMARY_OPEN, SWARM_SUMMARY_CLOSE, "summary"),
    ...extractBlock(text, SWARM_HANDOFF_OPEN, SWARM_HANDOFF_CLOSE, "handoff"),
  }
}

function extractBlock<K extends keyof ExtractedSwarmOutput>(
  text: string,
  open: string,
  close: string,
  key: K,
): Pick<ExtractedSwarmOutput, K> | Record<string, never> {
  const start = text.indexOf(open)
  if (start < 0) return {}
  const contentStart = start + open.length
  const end = text.indexOf(close, contentStart)
  if (end < 0) return {}
  const value = text.slice(contentStart, end).trim()
  return value ? { [key]: value } as Pick<ExtractedSwarmOutput, K> : {}
}

export function fallbackSummary(text: string, maxLength = 2000): string {
  return text.trim().slice(0, maxLength)
}
```

- [ ] **Step 4: Run prompt tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/prompt-builder.ts desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts
git commit -m "feat: build swarm worker prompts"
```

---

### Task 3: Scheduler Core

**Files:**
- Create: `desktop/app-capabilities/swarm-task/main/scheduler.ts`
- Create: `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

**Interfaces:**
- Consumes: `SwarmTaskConfig`, `SwarmWorkerRunStatus`.
- Produces: `createSwarmScheduler(deps: SwarmSchedulerDeps): SwarmScheduler`.
- Produces: `SwarmScheduler.start(input: SwarmSchedulerStartInput): Promise<SwarmSchedulerResult>`.
- Produces: `SwarmScheduler.stopRefill(runId: string): void`.
- Produces: `SwarmScheduler.cancel(runId: string): Promise<void>`.

- [ ] **Step 1: Write failing scheduler tests**

Create `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { createSwarmScheduler, type SwarmWorkerRunner } from "../scheduler"
import type { SwarmTaskConfig } from "../../shared/schema"

const config: SwarmTaskConfig = {
  projectId: "project-1",
  workspacePath: "/repo",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 3,
  maxRounds: 3,
  output: { mode: "managed-directory", targetFilePolicy: "append-only" },
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  agent: {},
}

describe("createSwarmScheduler", () => {
  it("runs fixed batch workers once", async () => {
    const calls: Array<{ workerIndex: number; roundIndex: number }> = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push({ workerIndex: input.workerIndex, roundIndex: input.roundIndex })
      return { status: "success", resultText: `done ${input.workerIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config,
    })

    expect(result.status).toBe("success")
    expect(calls).toEqual([
      { workerIndex: 1, roundIndex: 1 },
      { workerIndex: 2, roundIndex: 2 },
      { workerIndex: 3, roundIndex: 3 },
    ])
  })

  it("refills continuous workers until maxRounds", async () => {
    const calls: number[] = []
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      calls.push(input.roundIndex)
      return { status: "success", resultText: `round ${input.roundIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })

    const result = await scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "continuous", concurrency: 2, maxRounds: 5 },
    })

    expect(result.status).toBe("success")
    expect(calls.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
  })

  it("stopRefill drains active continuous workers", async () => {
    let releaseFirst: (() => void) | undefined
    const runner: SwarmWorkerRunner = vi.fn(async (input) => {
      if (input.roundIndex === 1) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve
        })
      }
      return { status: "success", resultText: `round ${input.roundIndex}` }
    })
    const scheduler = createSwarmScheduler({ runner })
    const promise = scheduler.start({
      taskId: "task-1",
      runId: "run-1",
      config: { ...config, runMode: "continuous", concurrency: 1, maxRounds: 5 },
    })

    await vi.waitFor(() => expect(runner).toHaveBeenCalledTimes(1))
    scheduler.stopRefill("run-1")
    releaseFirst?.()
    const result = await promise

    expect(result.status).toBe("success")
    expect(runner).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run scheduler tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

Expected: FAIL because `scheduler.ts` does not exist.

- [ ] **Step 3: Implement scheduler**

Create `desktop/app-capabilities/swarm-task/main/scheduler.ts`:

```ts
import type { SwarmTaskConfig, SwarmWorkerRunStatus } from "../shared/schema"

export type SwarmWorkerRunnerInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly config: SwarmTaskConfig
  readonly abortSignal?: AbortSignal
}

export type SwarmWorkerRunnerResult = {
  readonly status: Extract<SwarmWorkerRunStatus, "success" | "failed" | "cancelled" | "timeout">
  readonly resultText: string
  readonly error?: string
}

export type SwarmWorkerRunner = (input: SwarmWorkerRunnerInput) => Promise<SwarmWorkerRunnerResult>

export type SwarmSchedulerResult = {
  readonly status: "success" | "partial" | "failed" | "cancelled"
  readonly totals: {
    readonly started: number
    readonly success: number
    readonly failed: number
    readonly cancelled: number
    readonly timeout: number
  }
}

export type SwarmSchedulerStartInput = {
  readonly taskId: string
  readonly runId: string
  readonly config: SwarmTaskConfig
}

export type SwarmSchedulerDeps = {
  readonly runner: SwarmWorkerRunner
}

export type SwarmScheduler = ReturnType<typeof createSwarmScheduler>

type RunControl = {
  stopRefill: boolean
  abort: AbortController
}

export function createSwarmScheduler(deps: SwarmSchedulerDeps) {
  const controls = new Map<string, RunControl>()

  async function start(input: SwarmSchedulerStartInput): Promise<SwarmSchedulerResult> {
    const control: RunControl = { stopRefill: false, abort: new AbortController() }
    controls.set(input.runId, control)
    const totals = { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 }
    let nextRound = 1

    async function runRound(workerIndex: number, roundIndex: number): Promise<void> {
      totals.started++
      const result = await deps.runner({
        taskId: input.taskId,
        runId: input.runId,
        workerIndex,
        roundIndex,
        config: input.config,
        abortSignal: control.abort.signal,
      })
      if (result.status === "success") totals.success++
      if (result.status === "failed") totals.failed++
      if (result.status === "cancelled") totals.cancelled++
      if (result.status === "timeout") totals.timeout++
    }

    async function runSlot(workerIndex: number): Promise<void> {
      while (!control.stopRefill && nextRound <= input.config.maxRounds && !control.abort.signal.aborted) {
        const roundIndex = nextRound
        nextRound++
        await runRound(workerIndex, roundIndex)
        if (input.config.runMode === "batch") break
      }
    }

    const slotCount = input.config.runMode === "batch"
      ? Math.min(input.config.concurrency, input.config.maxRounds)
      : input.config.concurrency

    try {
      await Promise.all(Array.from({ length: slotCount }, (_, index) => runSlot(index + 1)))
    } finally {
      controls.delete(input.runId)
    }

    return { status: classifyTotals(totals), totals }
  }

  return {
    start,
    stopRefill(runId: string) {
      const control = controls.get(runId)
      if (control) control.stopRefill = true
    },
    async cancel(runId: string) {
      const control = controls.get(runId)
      if (!control) return
      control.stopRefill = true
      control.abort.abort("swarm-cancel")
    },
  }
}

function classifyTotals(totals: SwarmSchedulerResult["totals"]): SwarmSchedulerResult["status"] {
  if (totals.started > 0 && totals.success === totals.started) return "success"
  if (totals.success > 0) return "partial"
  if (totals.cancelled > 0 && totals.failed === 0 && totals.timeout === 0) return "cancelled"
  return "failed"
}
```

- [ ] **Step 4: Run scheduler tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/scheduler.ts desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts
git commit -m "feat: add swarm task scheduler"
```

---

### Task 4: Main Service With DataRepository And Fake Agent Gateway

**Files:**
- Create: `desktop/app-capabilities/swarm-task/main/service.ts`
- Create: `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: schemas and scheduler from Tasks 1-3.
- Produces: `createSwarmTaskService(deps: SwarmTaskServiceDeps): SwarmTaskService`.
- Produces methods: `listTasks`, `createTask`, `updateTask`, `deleteTask`, `startRun`, `stopRefill`, `cancelRun`, `listRuns`, `getRun`, `listWorkerRuns`.
- Produces dependency type `SwarmAgentGateway` with `sendWorker(input): Promise<SwarmAgentGatewayResult>` and `cancelConversation(projectId, conversationId): Promise<void>`.
- `startRun` must return the newly created `running` run immediately after scheduling background work; it must not wait for worker completion.

- [ ] **Step 1: Write failing service tests**

Create `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts` with in-memory namespaces and fake Agent gateway:

```ts
import { describe, expect, it, vi } from "vitest"
import { createSwarmTaskService, type SwarmAgentGateway } from "../service"
import type { SwarmRun, SwarmTask, SwarmWorkerRun } from "../../shared/schema"

function namespace<T extends { id: string }>() {
  const items = new Map<string, T>()
  return {
    async list(filter?: Partial<T>): Promise<T[]> {
      const values = [...items.values()]
      if (!filter) return values
      return values.filter((item) =>
        Object.entries(filter).every(([key, value]) => item[key as keyof T] === value))
    },
    async get(id: string): Promise<T | null> {
      return items.get(id) ?? null
    },
    async upsert(value: T): Promise<void> {
      items.set(value.id, value)
    },
    async remove(id: string): Promise<void> {
      items.delete(id)
    },
  }
}

const config = {
  projectId: "project-1",
  workspacePath: "/repo",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    outputProtocol: true,
    parallelContext: true,
    gitContext: false,
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  output: { mode: "managed-directory" as const, targetFilePolicy: "append-only" as const },
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  agent: {},
}

function serviceHarness(agent?: Partial<SwarmAgentGateway>) {
  const tasks = namespace<SwarmTask>()
  const runs = namespace<SwarmRun>()
  const workers = namespace<SwarmWorkerRun>()
  const gateway: SwarmAgentGateway = {
    sendWorker: vi.fn(async () => ({
      conversationId: "conversation-1",
      resultText: "<SYNAPSE_SWARM_SUMMARY>\ndone\n</SYNAPSE_SWARM_SUMMARY>",
      status: "success",
      events: [],
    })),
    cancelConversation: vi.fn(async () => undefined),
    ...agent,
  }
  const service = createSwarmTaskService({
    tasks,
    runs,
    workers,
    agent: gateway,
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    idFactory: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
    outputRoot: "/repo/swarm-runs",
  })
  return { service, tasks, runs, workers, gateway }
}

describe("createSwarmTaskService", () => {
  it("creates and lists reusable tasks", async () => {
    const { service } = serviceHarness()

    const task = await service.createTask({ name: "任务", config })

    expect(task.name).toBe("任务")
    expect(await service.listTasks()).toHaveLength(1)
  })

  it("snapshots config when starting a run", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })
    await service.updateTask({
      taskId: task.id,
      patch: { currentConfig: { ...config, prompt: "Changed prompt." } },
    })

    const run = await service.startRun({ taskId: task.id })

    expect(run.status).toBe("running")
    expect(run.configSnapshot.prompt).toBe("Changed prompt.")
    expect(run.outputDirectory).toBe("/repo/swarm-runs/id-2")
  })

  it("starts in the background and stores worker summaries", async () => {
    const { service } = serviceHarness()
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({ taskId: task.id })
    expect(run.status).toBe("running")

    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })
    const workerRuns = await service.listWorkerRuns(run.id)

    expect(workerRuns).toHaveLength(2)
    expect(workerRuns[0]?.sessionKey).toBe(`swarm:${task.id}:${run.id}`)
    expect(workerRuns.every((worker) => worker.summary === "done")).toBe(true)
  })

  it("stores fallback summary when summary block is missing", async () => {
    const { service } = serviceHarness({
      sendWorker: vi.fn(async () => ({
        conversationId: "conversation-1",
        resultText: "plain final result",
        status: "success",
        events: [],
      })),
    })
    const task = await service.createTask({ name: "任务", config })

    const run = await service.startRun({ taskId: task.id })
    await vi.waitFor(async () => {
      expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
    })
    const workerRuns = await service.listWorkerRuns(run.id)

    expect(workerRuns[0]?.summary).toBe("plain final result")
    expect(workerRuns[0]?.summaryFallback).toBe(true)
  })
})
```

- [ ] **Step 2: Run service tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

Expected: FAIL because `service.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `desktop/app-capabilities/swarm-task/main/service.ts` with these exported interfaces and methods:

```ts
import { randomUUID } from "node:crypto"
import path from "node:path"
import type { DataNamespace } from "../../../electron/runtime/data-repo"
import type { AgentEvent } from "../../../electron/services/agent-runtime"
import {
  swarmRunStartInputSchema,
  swarmTaskCreateInputSchema,
  swarmTaskUpdateInputSchema,
  type SwarmRun,
  type SwarmRunStartInput,
  type SwarmTask,
  type SwarmTaskCreateInput,
  type SwarmTaskUpdateInput,
  type SwarmWorkerRun,
} from "../shared/schema"
import { buildSwarmWorkerPrompt, extractSwarmStructuredOutput, fallbackSummary } from "./prompt-builder"
import { createSwarmScheduler, type SwarmWorkerRunner } from "./scheduler"

export type SwarmAgentGatewayResult = {
  readonly conversationId: string
  readonly resultText: string
  readonly status: "success" | "failed" | "cancelled" | "timeout"
  readonly events: readonly AgentEvent[]
  readonly error?: string
}

export type SwarmAgentGatewayInput = {
  readonly task: SwarmTask
  readonly run: SwarmRun
  readonly worker: SwarmWorkerRun
  readonly prompt: string
  readonly abortSignal?: AbortSignal
}

export type SwarmAgentGateway = {
  sendWorker(input: SwarmAgentGatewayInput): Promise<SwarmAgentGatewayResult>
  cancelConversation(projectId: string, conversationId: string): Promise<void>
}

export type SwarmTaskServiceDeps = {
  readonly tasks: Pick<DataNamespace<SwarmTask>, "list" | "get" | "upsert" | "remove">
  readonly runs: Pick<DataNamespace<SwarmRun>, "list" | "get" | "upsert" | "remove">
  readonly workers: Pick<DataNamespace<SwarmWorkerRun>, "list" | "get" | "upsert" | "remove">
  readonly agent: SwarmAgentGateway
  readonly outputRoot: string
  readonly now?: () => Date
  readonly idFactory?: () => string
}

export type SwarmTaskService = ReturnType<typeof createSwarmTaskService>

export function createSwarmTaskService(deps: SwarmTaskServiceDeps) {
  const now = () => (deps.now ?? (() => new Date()))().toISOString()
  const id = deps.idFactory ?? (() => randomUUID())
  const scheduler = createSwarmScheduler({ runner: createWorkerRunner() })
  const runningRuns = new Map<string, Promise<void>>()

  async function listTasks(): Promise<SwarmTask[]> {
    return (await deps.tasks.list()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  }

  async function createTask(input: SwarmTaskCreateInput): Promise<SwarmTask> {
    const parsed = swarmTaskCreateInputSchema.parse(input)
    const timestamp = now()
    const task: SwarmTask = {
      id: id(),
      schemaVersion: 1,
      name: parsed.name.trim(),
      description: parsed.description,
      currentConfig: parsed.config,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    await deps.tasks.upsert(task)
    return task
  }

  async function updateTask(input: SwarmTaskUpdateInput): Promise<SwarmTask> {
    const parsed = swarmTaskUpdateInputSchema.parse(input)
    const task = await requireTask(parsed.taskId)
    const updated: SwarmTask = {
      ...task,
      ...("name" in parsed.patch && parsed.patch.name ? { name: parsed.patch.name.trim() } : {}),
      ...("description" in parsed.patch ? { description: parsed.patch.description } : {}),
      ...("currentConfig" in parsed.patch && parsed.patch.currentConfig ? { currentConfig: parsed.patch.currentConfig } : {}),
      updatedAt: now(),
    }
    await deps.tasks.upsert(updated)
    return updated
  }

  async function deleteTask(taskId: string): Promise<void> {
    await deps.tasks.remove(taskId)
  }

  async function startRun(input: SwarmRunStartInput): Promise<SwarmRun> {
    const parsed = swarmRunStartInputSchema.parse(input)
    const task = await requireTask(parsed.taskId)
    const runId = id()
    const configSnapshot = {
      ...task.currentConfig,
      ...parsed.configOverride,
      output: {
        ...task.currentConfig.output,
        ...parsed.configOverride?.output,
      },
    }
    const run: SwarmRun = {
      id: runId,
      schemaVersion: 1,
      taskId: task.id,
      status: "running",
      configSnapshot,
      startedAt: now(),
      totals: { started: 0, success: 0, failed: 0, cancelled: 0, timeout: 0 },
      outputDirectory: configSnapshot.output.managedDirectory ?? path.join(deps.outputRoot, runId),
      stopRequested: false,
    }
    await deps.runs.upsert(run)
    await deps.tasks.upsert({ ...task, lastRunId: run.id, lastStatus: "running", updatedAt: now() })

    const promise = finishRunInBackground(task.id, run)
    runningRuns.set(run.id, promise)
    void promise.finally(() => {
      runningRuns.delete(run.id)
    })
    return run
  }

  async function finishRunInBackground(taskId: string, run: SwarmRun): Promise<void> {
    try {
      const result = await scheduler.start({ taskId, runId: run.id, config: run.configSnapshot })
      const latestRun = await deps.runs.get(run.id)
      if (!latestRun || latestRun.status === "cancelled") return
      const finished: SwarmRun = {
        ...latestRun,
        status: result.status,
        totals: result.totals,
        finishedAt: now(),
      }
      await deps.runs.upsert(finished)
      const latestTask = await requireTask(taskId)
      await deps.tasks.upsert({ ...latestTask, lastRunId: run.id, lastStatus: finished.status, updatedAt: now() })
    } catch (error) {
      const latestRun = await deps.runs.get(run.id)
      if (!latestRun) return
      const failed: SwarmRun = {
        ...latestRun,
        status: "failed",
        finishedAt: now(),
      }
      await deps.runs.upsert(failed)
      const latestTask = await requireTask(taskId)
      await deps.tasks.upsert({ ...latestTask, lastRunId: run.id, lastStatus: "failed", updatedAt: now() })
    }
  }

  async function stopRefill(runId: string): Promise<SwarmRun | null> {
    scheduler.stopRefill(runId)
    const run = await deps.runs.get(runId)
    if (!run) return null
    const updated: SwarmRun = { ...run, status: "draining", stopRequested: true }
    await deps.runs.upsert(updated)
    return updated
  }

  async function cancelRun(runId: string): Promise<SwarmRun | null> {
    await scheduler.cancel(runId)
    const run = await deps.runs.get(runId)
    if (!run) return null
    const activeWorkers = await deps.workers.list({ runId, status: "running" } as Partial<SwarmWorkerRun>)
    await Promise.all(activeWorkers.map((worker) =>
      worker.conversationId ? deps.agent.cancelConversation(run.configSnapshot.projectId, worker.conversationId) : Promise.resolve()))
    const updated: SwarmRun = { ...run, status: "cancelled", stopRequested: true, finishedAt: now() }
    await deps.runs.upsert(updated)
    await runningRuns.get(runId)?.catch(() => undefined)
    return updated
  }

  async function listRuns(taskId?: string, limit = 100): Promise<SwarmRun[]> {
    const runs = taskId
      ? await deps.runs.list({ taskId } as Partial<SwarmRun>)
      : await deps.runs.list()
    return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt)).slice(0, limit)
  }

  function getRun(runId: string): Promise<SwarmRun | null> {
    return deps.runs.get(runId)
  }

  async function listWorkerRuns(runId: string): Promise<SwarmWorkerRun[]> {
    return (await deps.workers.list({ runId } as Partial<SwarmWorkerRun>))
      .sort((left, right) => left.roundIndex - right.roundIndex || left.workerIndex - right.workerIndex)
  }

  async function requireTask(taskId: string): Promise<SwarmTask> {
    const task = await deps.tasks.get(taskId)
    if (!task) throw new Error(`Swarm task not found: ${taskId}`)
    return task
  }

  function createWorkerRunner(): SwarmWorkerRunner {
    return async (input) => {
      const task = await requireTask(input.taskId)
      const run = await deps.runs.get(input.runId)
      if (!run) throw new Error(`Swarm run not found: ${input.runId}`)
      const previousWorkers = await listWorkerRuns(run.id)
      const previousHandoff = input.config.handoff.enabled
        ? previousWorkers.filter((worker) => worker.handoff?.trim()).at(-1)?.handoff
        : undefined
      const worker: SwarmWorkerRun = {
        id: id(),
        schemaVersion: 1,
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        status: "running",
        sessionKey: `swarm:${input.taskId}:${input.runId}`,
        startedAt: now(),
        lastPhase: "queued",
      }
      await deps.workers.upsert(worker)
      const prompt = buildSwarmWorkerPrompt({
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        config: input.config,
        recentSummaries: previousWorkers,
        previousHandoff,
      })
      const result = await deps.agent.sendWorker({ task, run, worker, prompt, abortSignal: input.abortSignal })
      const extracted = extractSwarmStructuredOutput(result.resultText)
      const summary = input.config.summary.enabled
        ? extracted.summary ?? fallbackSummary(result.resultText)
        : undefined
      const summaryFallback = input.config.summary.enabled && !extracted.summary
      const updated: SwarmWorkerRun = {
        ...worker,
        status: result.status,
        conversationId: result.conversationId,
        finishedAt: now(),
        lastPhase: result.status === "success" ? "completed" : "failed",
        lastMessage: result.error ?? result.resultText.slice(0, 500),
        ...(summary ? { summary, summaryFallback } : {}),
        ...(input.config.handoff.enabled && extracted.handoff ? { handoff: extracted.handoff } : {}),
        ...(result.error ? { error: result.error } : {}),
      }
      await deps.workers.upsert(updated)
      return { status: result.status, resultText: result.resultText, error: result.error }
    }
  }

  return {
    listTasks,
    createTask,
    updateTask,
    deleteTask,
    startRun,
    stopRefill,
    cancelRun,
    listRuns,
    getRun,
    listWorkerRuns,
  }
}
```

- [ ] **Step 4: Run service tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/service.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
git commit -m "feat: add swarm task service"
```

---

### Task 5: Agent Runtime Integration And Conversation Source

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/service.ts`
- Modify: `desktop/src/types/agent-navigation.ts`
- Modify: `desktop/src/modules/agent/conversation-source.ts`
- Modify: `desktop/electron/modules/agent/ipc-sessions.ts`
- Test: `desktop/src/modules/agent/__tests__/conversation-source.test.ts`
- Test: `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts`
- Test: `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: `resolveProjectAgent(ctx.resolve, projectId)` from existing Agent IPC helper pattern.
- Produces: a production `SwarmAgentGateway` factory inside `service.ts`, named `createAgentRuntimeSwarmGateway`.
- Produces: new platform/source values `swarm`.

- [ ] **Step 1: Extend existing tests for swarm source**

Modify `desktop/src/modules/agent/__tests__/conversation-source.test.ts` to add:

```ts
expect(conversationSourceForSession(session("swarm"))).toBe("swarm")
```

Update filter expectations with a swarm session:

```ts
expect(filterSessionsBySource(sessions, "swarm").map((item) => item.platform)).toEqual(["swarm"])
```

Modify `desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts` by copying the existing workflow open conversation test and changing these values:

```ts
platform: "swarm",
sessionKey: "swarm:task-1:run-1",
sourceFilter: "swarm",
```

- [ ] **Step 2: Run conversation source tests to verify they fail**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/__tests__/conversation-source.test.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts
```

Expected: FAIL because `swarm` is not classified or allowed.

- [ ] **Step 3: Add `swarm` platform and source type**

Modify `desktop/src/types/agent-navigation.ts`:

```ts
export type SynapseAgentConversationPlatform = "automation" | "workflow" | "scheduled" | "swarm"

export type SynapseAgentConversationSourceFilter =
  | "user"
  | "scheduled"
  | "automation"
  | "workflow"
  | "swarm"
  | "webhook"
  | "relay"
  | "bridge"
  | "all"
```

- [ ] **Step 4: Classify swarm conversations**

Modify `desktop/src/modules/agent/conversation-source.ts`:

```ts
  { value: "swarm", label: "蜂群任务" },
```

Add inside `conversationSourceForPlatform`:

```ts
  if (normalized === "swarm") return "swarm"
```

- [ ] **Step 5: Allow open conversation IPC for swarm**

Modify `desktop/electron/modules/agent/ipc-sessions.ts`:

```ts
platform: z.enum(["automation", "workflow", "scheduled", "swarm"]),
```

- [ ] **Step 6: Add Agent Runtime gateway**

Modify `desktop/app-capabilities/swarm-task/main/service.ts` to export:

```ts
import type { AgentRuntimeService } from "../../../electron/services/agent-runtime"
import type { AgentMessage } from "../../../electron/services/agent-runtime"

export function createAgentRuntimeSwarmGateway(deps: {
  readonly resolveAgent: (projectId: string) => Promise<AgentRuntimeService>
}): SwarmAgentGateway {
  return {
    async sendWorker(input) {
      const agent = await deps.resolveAgent(input.task.currentConfig.projectId)
      const message: AgentMessage = {
        projectId: input.task.currentConfig.projectId,
        sessionKey: input.worker.sessionKey,
        platform: "swarm",
        content: input.prompt,
        workspacePath: input.task.currentConfig.workspacePath,
        agentType: "claude-code",
        providerId: input.task.currentConfig.agent.providerId,
        modelTier: input.task.currentConfig.agent.modelTier,
        modeOverride: input.task.currentConfig.agent.permissionMode,
        userMeta: {
          swarmTaskId: input.task.id,
          swarmRunId: input.run.id,
          swarmWorkerRunId: input.worker.id,
          swarmRoundIndex: input.worker.roundIndex,
          swarmWorkerIndex: input.worker.workerIndex,
        },
      }
      const result = await agent.sendNewSession(
        message,
        `${input.task.name} #${input.worker.roundIndex}`,
        { abortSignal: input.abortSignal },
      )
      return {
        conversationId: result.conversationId,
        resultText: result.resultText,
        status: result.error ? "failed" : "success",
        events: result.events,
        error: result.error,
      }
    },
    async cancelConversation(projectId, conversationId) {
      const agent = await deps.resolveAgent(projectId)
      await agent.cancelTurn(conversationId)
    },
  }
}
```

- [ ] **Step 7: Run source and service tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/src/modules/agent/__tests__/conversation-source.test.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/service.ts desktop/src/types/agent-navigation.ts desktop/src/modules/agent/conversation-source.ts desktop/electron/modules/agent/ipc-sessions.ts desktop/src/modules/agent/__tests__/conversation-source.test.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
git commit -m "feat: add swarm agent conversation source"
```

---

### Task 6: Service Registration, IPC, And Preload Bridge

**Files:**
- Create: `desktop/app-capabilities/swarm-task/main/ipc.ts`
- Create: `desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`
- Modify: `desktop/electron/bootstrap/registry.ts`
- Modify: `desktop/electron/bootstrap/ipc-registry.ts`
- Modify: `desktop/electron/preload.ts`
- Test: `desktop/electron/__tests__/preload.test.ts`
- Test: `desktop/electron/bootstrap/__tests__/registry.test.ts`
- Test: `desktop/electron/bootstrap/__tests__/descriptors.test.ts`

**Interfaces:**
- Consumes: `createSwarmTaskService`, `createAgentRuntimeSwarmGateway`, and schemas from prior tasks.
- Produces bridge domain `swarmTask`.
- Produces IPC methods: `listTasks`, `createTask`, `updateTask`, `deleteTask`, `startRun`, `stopRefill`, `cancelRun`, `listRuns`, `getRun`, `listWorkerRuns`.

- [ ] **Step 1: Write IPC test**

Create `desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { swarmTaskIpcModule } from "../ipc"

describe("swarmTaskIpcModule", () => {
  it("declares swarm task channels", () => {
    expect(swarmTaskIpcModule.id).toBe("swarmTask")
    expect(swarmTaskIpcModule.methods.listTasks.channel).toBe("synapse:swarm-task:tasks:list")
    expect(swarmTaskIpcModule.methods.startRun.channel).toBe("synapse:swarm-task:runs:start")
  })

  it("routes task and run calls to the service", async () => {
    const service = {
      listTasks: vi.fn(async () => []),
      createTask: vi.fn(async (input) => ({ id: "task-1", ...input })),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
      startRun: vi.fn(async () => ({ id: "run-1" })),
      stopRefill: vi.fn(),
      cancelRun: vi.fn(),
      listRuns: vi.fn(async () => []),
      getRun: vi.fn(async () => null),
      listWorkerRuns: vi.fn(async () => []),
    }
    const ctx = {
      resolve: (id: string) => {
        if (id === "core.swarm-task") return service
        throw new Error(id)
      },
    }

    await swarmTaskIpcModule.methods.listTasks.handler(ctx as never, undefined)
    await swarmTaskIpcModule.methods.startRun.handler(ctx as never, { taskId: "task-1" })

    expect(service.listTasks).toHaveBeenCalled()
    expect(service.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
  })
})
```

- [ ] **Step 2: Run IPC test to verify it fails**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts`

Expected: FAIL because `ipc.ts` does not exist.

- [ ] **Step 3: Implement IPC module**

Create `desktop/app-capabilities/swarm-task/main/ipc.ts`:

```ts
import { z } from "zod"
import type { IpcModule } from "../../../electron/runtime/ipc/types"
import type { SwarmTaskService } from "./service"
import { SWARM_TASK_SERVICE_ID } from "../shared/capability"
import {
  swarmRunIdInputSchema,
  swarmRunListInputSchema,
  swarmRunListResultSchema,
  swarmRunSchema,
  swarmRunStartInputSchema,
  swarmTaskCreateInputSchema,
  swarmTaskIdInputSchema,
  swarmTaskListResultSchema,
  swarmTaskSchema,
  swarmTaskUpdateInputSchema,
  swarmWorkerRunListResultSchema,
} from "../shared/schema"

function service(ctx: Parameters<IpcModule["methods"][string]["handler"]>[0]): SwarmTaskService {
  return ctx.resolve<SwarmTaskService>(SWARM_TASK_SERVICE_ID)
}

export const swarmTaskIpcModule: IpcModule = {
  id: "swarmTask",
  methods: {
    listTasks: {
      channel: "synapse:swarm-task:tasks:list",
      kind: "invoke",
      request: z.void(),
      response: swarmTaskListResultSchema,
      handler: (ctx) => service(ctx).listTasks(),
    },
    createTask: {
      channel: "synapse:swarm-task:tasks:create",
      kind: "invoke",
      request: swarmTaskCreateInputSchema,
      response: swarmTaskSchema,
      handler: (ctx, request) => service(ctx).createTask(request),
    },
    updateTask: {
      channel: "synapse:swarm-task:tasks:update",
      kind: "invoke",
      request: swarmTaskUpdateInputSchema,
      response: swarmTaskSchema,
      handler: (ctx, request) => service(ctx).updateTask(request),
    },
    deleteTask: {
      channel: "synapse:swarm-task:tasks:delete",
      kind: "invoke",
      request: swarmTaskIdInputSchema,
      response: z.void(),
      handler: (ctx, request) => service(ctx).deleteTask(request.taskId),
    },
    startRun: {
      channel: "synapse:swarm-task:runs:start",
      kind: "invoke",
      request: swarmRunStartInputSchema,
      response: swarmRunSchema,
      handler: (ctx, request) => service(ctx).startRun(request),
    },
    stopRefill: {
      channel: "synapse:swarm-task:runs:stop-refill",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request) => service(ctx).stopRefill(request.runId),
    },
    cancelRun: {
      channel: "synapse:swarm-task:runs:cancel",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request) => service(ctx).cancelRun(request.runId),
    },
    listRuns: {
      channel: "synapse:swarm-task:runs:list",
      kind: "invoke",
      request: swarmRunListInputSchema.optional(),
      response: swarmRunListResultSchema,
      handler: (ctx, request) => service(ctx).listRuns(request?.taskId, request?.limit),
    },
    getRun: {
      channel: "synapse:swarm-task:runs:get",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmRunSchema.nullable(),
      handler: (ctx, request) => service(ctx).getRun(request.runId),
    },
    listWorkerRuns: {
      channel: "synapse:swarm-task:worker-runs:list",
      kind: "invoke",
      request: swarmRunIdInputSchema,
      response: swarmWorkerRunListResultSchema,
      handler: (ctx, request) => service(ctx).listWorkerRuns(request.runId),
    },
  },
  events: {},
}
```

- [ ] **Step 4: Register service descriptor**

Modify `desktop/electron/bootstrap/descriptors.ts`:

Add imports:

```ts
import {
  SWARM_TASK_RUNS_NAMESPACE,
  SWARM_TASK_TASKS_NAMESPACE,
  SWARM_TASK_WORKER_RUNS_NAMESPACE,
  type SwarmRunEntryV1,
  type SwarmTaskEntryV1,
  type SwarmWorkerRunEntryV1,
} from "../runtime/data-repo/schemas"
import { SWARM_TASK_SERVICE_ID } from "../../app-capabilities/swarm-task/shared/capability"
import {
  createAgentRuntimeSwarmGateway,
  createSwarmTaskService,
  type SwarmTaskService,
} from "../../app-capabilities/swarm-task/main/service"
import { resolveProjectAgent } from "../modules/agent/ipc-shared"
```

Add descriptor near other app capability services:

```ts
export const coreSwarmTaskDescriptor: ServiceDescriptor<SwarmTaskService> = {
  id: SWARM_TASK_SERVICE_ID,
  criticality: "degraded",
  dependsOn: ["core.data-repository", "core.project-containers"],
  create(ctx) {
    const dataRepository = ctx.registry.get<DataRepository>("core.data-repository")
    return createSwarmTaskService({
      tasks: dataRepository.namespace<SwarmTaskEntryV1>(SWARM_TASK_TASKS_NAMESPACE),
      runs: dataRepository.namespace<SwarmRunEntryV1>(SWARM_TASK_RUNS_NAMESPACE),
      workers: dataRepository.namespace<SwarmWorkerRunEntryV1>(SWARM_TASK_WORKER_RUNS_NAMESPACE),
      outputRoot: path.join(app.getPath("userData"), "swarm-runs"),
      agent: createAgentRuntimeSwarmGateway({
        resolveAgent: async (projectId) => {
          const { agent } = await resolveProjectAgent(ctx.registry.get.bind(ctx.registry), projectId)
          return agent
        },
      }),
    })
  },
}
```

Modify `desktop/electron/bootstrap/registry.ts`:

```ts
import {
  coreSwarmTaskDescriptor,
} from "./descriptors"
```

Register it after `coreProjectContainerRegistryDescriptor` and before `coreAutomationDescriptor`:

```ts
  registry.register(coreSwarmTaskDescriptor)
```

- [ ] **Step 5: Register IPC module**

Modify `desktop/electron/bootstrap/ipc-registry.ts`:

```ts
import { swarmTaskIpcModule } from "../../app-capabilities/swarm-task/main/ipc"
```

Register before `opsIpcModule`:

```ts
  registry.register(swarmTaskIpcModule, ctx)
```

Add to `registeredIpcModules`:

```ts
  swarmTaskIpcModule,
```

- [ ] **Step 6: Add preload bridge**

Modify `desktop/electron/preload.ts`.

Add `IPC_CHANNELS.swarmTask`:

```ts
  "swarmTask": {
    "listTasks": "synapse:swarm-task:tasks:list",
    "createTask": "synapse:swarm-task:tasks:create",
    "updateTask": "synapse:swarm-task:tasks:update",
    "deleteTask": "synapse:swarm-task:tasks:delete",
    "startRun": "synapse:swarm-task:runs:start",
    "stopRefill": "synapse:swarm-task:runs:stop-refill",
    "cancelRun": "synapse:swarm-task:runs:cancel",
    "listRuns": "synapse:swarm-task:runs:list",
    "getRun": "synapse:swarm-task:runs:get",
    "listWorkerRuns": "synapse:swarm-task:worker-runs:list",
  },
```

Add bridge methods:

```ts
  swarmTask: {
    listTasks: () => invoke(IPC_CHANNELS.swarmTask.listTasks)(),
    createTask: (input) => invoke(IPC_CHANNELS.swarmTask.createTask)(input),
    updateTask: (input) => invoke(IPC_CHANNELS.swarmTask.updateTask)(input),
    deleteTask: (taskId) => invoke(IPC_CHANNELS.swarmTask.deleteTask)({ taskId }),
    startRun: (input) => invoke(IPC_CHANNELS.swarmTask.startRun)(input),
    stopRefill: (runId) => invoke(IPC_CHANNELS.swarmTask.stopRefill)({ runId }),
    cancelRun: (runId) => invoke(IPC_CHANNELS.swarmTask.cancelRun)({ runId }),
    listRuns: (input) => invoke(IPC_CHANNELS.swarmTask.listRuns)(input),
    getRun: (runId) => invoke(IPC_CHANNELS.swarmTask.getRun)({ runId }),
    listWorkerRuns: (runId) => invoke(IPC_CHANNELS.swarmTask.listWorkerRuns)({ runId }),
  },
```

- [ ] **Step 7: Add preload test coverage**

Modify `desktop/electron/__tests__/preload.test.ts` to call each new bridge method and expect the channels listed above.

- [ ] **Step 8: Run IPC, preload, and registry tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts desktop/electron/__tests__/preload.test.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/ipc.ts desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts desktop/electron/bootstrap/descriptors.ts desktop/electron/bootstrap/registry.ts desktop/electron/bootstrap/ipc-registry.ts desktop/electron/preload.ts desktop/electron/__tests__/preload.test.ts desktop/electron/bootstrap/__tests__/registry.test.ts desktop/electron/bootstrap/__tests__/descriptors.test.ts
git commit -m "feat: wire swarm task service"
```

---

### Task 7: Renderer System App

**Files:**
- Create: `desktop/app-capabilities/swarm-task/renderer/app-definition.ts`
- Create: `desktop/app-capabilities/swarm-task/renderer/app-manifest.ts`
- Create: `desktop/app-capabilities/swarm-task/renderer/index.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-sidebar.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/components/swarm-run-panel.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/components/swarm-run-history.tsx`
- Create: `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`
- Modify: `desktop/src/modules/apps/types.ts`
- Modify: `desktop/src/modules/apps/registry.ts`

**Interfaces:**
- Consumes: `window.synapse.swarmTask` bridge from Task 6.
- Produces: `SwarmTaskModule` React component.
- Produces: system app id `swarm-task`.

- [ ] **Step 1: Write renderer tests**

Create `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx` with bridge mocks matching local app tests:

```tsx
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { SwarmTaskModule } from "../index"

const task = {
  id: "task-1",
  schemaVersion: 1,
  name: "巡检",
  currentConfig: {
    projectId: "project-1",
    workspacePath: "/repo",
    prompt: "Run.",
    presetId: "general",
    injectOptions: {
      workerIdentity: true,
      roundContext: true,
      runContext: true,
      outputProtocol: true,
      parallelContext: true,
      gitContext: false,
      customAppendix: "",
    },
    runMode: "batch",
    concurrency: 2,
    maxRounds: 2,
    output: { mode: "managed-directory", targetFilePolicy: "append-only" },
    summary: { enabled: true, injectRecent: false, recentLimit: 3 },
    handoff: { enabled: false },
    agent: {},
  },
  createdAt: "2026-07-07T00:00:00.000Z",
  updatedAt: "2026-07-07T00:00:00.000Z",
}

function installBridge(overrides = {}) {
  const swarmTask = {
    listTasks: vi.fn(async () => [task]),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    deleteTask: vi.fn(),
    startRun: vi.fn(async () => ({ id: "run-1", taskId: task.id, status: "success" })),
    stopRefill: vi.fn(),
    cancelRun: vi.fn(),
    listRuns: vi.fn(async () => []),
    getRun: vi.fn(),
    listWorkerRuns: vi.fn(async () => []),
    ...overrides,
  }
  vi.stubGlobal("window", {
    synapse: {
      swarmTask,
      agent: {
        openConversation: vi.fn(),
      },
    },
  })
  return swarmTask
}

describe("SwarmTaskModule", () => {
  it("renders task list and selected task details", async () => {
    installBridge()
    render(<SwarmTaskModule />)

    expect(await screen.findByText("巡检")).toBeInTheDocument()
    expect(screen.getByDisplayValue("Run.")).toBeInTheDocument()
  })

  it("starts a selected task", async () => {
    const bridge = installBridge()
    render(<SwarmTaskModule />)

    await screen.findByText("巡检")
    await userEvent.click(screen.getByRole("button", { name: "运行" }))

    await waitFor(() => expect(bridge.startRun).toHaveBeenCalledWith({ taskId: "task-1" }))
  })
})
```

- [ ] **Step 2: Run renderer tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`

Expected: FAIL because renderer files do not exist.

- [ ] **Step 3: Add app definition and manifest**

Create `desktop/app-capabilities/swarm-task/renderer/app-definition.ts`:

```ts
import { Boxes } from "lucide-react"
import type { SynapseSystemAppDefinition } from "../../../src/modules/apps/types"
import { SWARM_TASK_APP_ID } from "../shared/capability"
import { SwarmTaskModule } from "./index"

export const swarmTaskAppDefinition = {
  id: SWARM_TASK_APP_ID,
  name: "蜂群任务",
  description: "多 Agent 任务",
  icon: Boxes,
  component: SwarmTaskModule,
} as const satisfies SynapseSystemAppDefinition
```

Create `desktop/app-capabilities/swarm-task/renderer/app-manifest.ts`:

```ts
import type { SynapseSystemAppManifest } from "../../../src/modules/apps/types"
import { swarmTaskAppDefinition } from "./app-definition"

export const swarmTaskAppManifest = {
  ...swarmTaskAppDefinition,
} as const satisfies SynapseSystemAppManifest
```

- [ ] **Step 4: Add renderer components**

Implement `desktop/app-capabilities/swarm-task/renderer/index.tsx` with `SystemAppWindowShell`, `SidebarContentLayout`, `Button`, `Tabs`, `toast`, and `requireBridgeDomain("swarmTask")`. Keep state in hooks inside this file:

```tsx
export function SwarmTaskModule() {
  // load tasks, select first task, load selected run history and worker runs
  // actions: new task, start selected task, stop refill, refresh
}
```

Use these component responsibilities:

- `SwarmTaskSidebar`: search input and task rows.
- `SwarmTaskDetail`: tabs for `配置`, `运行中`, `历史`.
- `SwarmTaskConfigForm`: controlled form for prompt, run mode, concurrency, max rounds, summary, handoff, output mode.
- `SwarmRunPanel`: worker table with `Open` icon button.
- `SwarmRunHistory`: run table with rerun action.

Use existing components only: `Button`, `Input`, `Textarea`, `Select`, `Tabs`, `Table`, `Switch`, `ScrollArea`, `Empty`, `Skeleton`.

- [ ] **Step 5: Register system app**

Modify `desktop/src/modules/apps/types.ts` so `swarm-task` is a valid app id.

Modify `desktop/src/modules/apps/registry.ts`:

```ts
import { swarmTaskAppManifest } from "../../../app-capabilities/swarm-task/renderer/app-manifest"
```

Add `swarmTaskAppManifest` to `systemApps`.

- [ ] **Step 6: Run renderer tests**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx desktop/src/modules/apps/__tests__/registry.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/swarm-task/renderer desktop/src/modules/apps/types.ts desktop/src/modules/apps/registry.ts
git commit -m "feat: add swarm task app UI"
```

---

### Task 8: MCP Dispatcher And Capability Routing

**Files:**
- Create: `desktop/app-capabilities/swarm-task/main/dispatcher.ts`
- Create: `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/app-capabilities/dispatcher.ts`
- Modify: `desktop/app-capabilities/__tests__/dispatcher.test.ts`

**Interfaces:**
- Consumes: `SwarmTaskService`.
- Produces: `createSwarmTaskCapabilityDispatcher(deps): SwarmTaskCapabilityDispatcher`.
- Produces routing for all `app.swarm_task.*` ids.

- [ ] **Step 1: Write dispatcher tests**

Create `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest"
import { SWARM_TASK_RUN_START_CAPABILITY_ID, SWARM_TASK_TASK_LIST_CAPABILITY_ID } from "../../shared/capability"
import { createSwarmTaskCapabilityDispatcher } from "../dispatcher"

describe("createSwarmTaskCapabilityDispatcher", () => {
  it("routes list and start actions", async () => {
    const service = {
      listTasks: vi.fn(async () => []),
      startRun: vi.fn(async () => ({ id: "run-1" })),
    }
    const dispatcher = createSwarmTaskCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(SWARM_TASK_TASK_LIST_CAPABILITY_ID, {}, { source: "mcp-http" }))
      .resolves.toEqual({ ok: true, data: [], affected: 0 })
    await dispatcher.dispatch(SWARM_TASK_RUN_START_CAPABILITY_ID, { taskId: "task-1" }, { source: "mcp-http" })

    expect(service.startRun).toHaveBeenCalledWith({ taskId: "task-1" })
  })
})
```

- [ ] **Step 2: Run dispatcher tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`

Expected: FAIL because dispatcher does not exist.

- [ ] **Step 3: Implement dispatcher**

Create `desktop/app-capabilities/swarm-task/main/dispatcher.ts` that parses params with schemas and returns `{ ok: true, data, affected }`. Route every id from `SWARM_TASK_CAPABILITY_IDS`. For delete and cancel actions, return `affected: 1` when a record existed and `affected: 0` when null.

- [ ] **Step 4: Add top-level app dispatcher routing**

Modify `desktop/app-capabilities/dispatcher.ts`:

- Add `swarmTask` to dependencies.
- If `action` is in `SWARM_TASK_CAPABILITY_IDS`, route to `deps.swarmTask.dispatch(action, params, context)`.

Modify `desktop/app-capabilities/__tests__/dispatcher.test.ts` to include a swarm dispatcher and assert one swarm action routes to it.

- [ ] **Step 5: Confirm action router uses existing app domain routing**

Run:

```bash
sed -n '1,120p' desktop/electron/capabilities/action-router.ts
```

Expected: `createSynapseActionRouter` routes `domainId === "app"` to `deps.appDispatch(...)`. Do not modify `desktop/electron/capabilities/action-router.ts` for this feature.

- [ ] **Step 6: Run dispatcher tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/__tests__/dispatcher.test.ts desktop/electron/capabilities/__tests__/workflow-dispatcher.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/dispatcher.ts desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/dispatcher.ts desktop/app-capabilities/__tests__/dispatcher.test.ts
git commit -m "feat: add swarm task MCP dispatcher"
```

---

### Task 9: Workflow Node

**Files:**
- Create: `desktop/app-capabilities/swarm-task/workflow-node/schema.ts`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/manifest.ts`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/executor.main.ts`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/panel.tsx`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/card.tsx`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`
- Create: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`
- Modify: `desktop/workflow-nodes/register.main.ts`
- Modify: `desktop/workflow-nodes/register.renderer.ts`
- Modify: `desktop/workflow-nodes/panel-registry.ts`
- Test: `desktop/workflow-nodes/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `SWARM_TASK_WORKFLOW_NODE_TYPE`.
- Consumes: `core.swarm-task` service from workflow runtime deps or registry access pattern.
- Produces: `swarmTaskNodeConfigSchema`, `swarmTaskNodeManifest`, `swarmTaskNodeExecutor`.

- [ ] **Step 1: Write schema and executor tests**

Create `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { swarmTaskNodeConfigSchema } from "../schema"

describe("swarmTaskNodeConfigSchema", () => {
  it("accepts minimal config", () => {
    expect(swarmTaskNodeConfigSchema.parse({
      taskId: "task-1",
      waitForCompletion: false,
    })).toEqual({
      taskId: "task-1",
      waitForCompletion: false,
    })
  })

  it("accepts overrides", () => {
    expect(swarmTaskNodeConfigSchema.safeParse({
      taskId: "task-1",
      promptOverride: "Run.",
      runModeOverride: "continuous",
      maxRoundsOverride: 5,
      concurrencyOverride: 2,
      waitForCompletion: true,
    }).success).toBe(true)
  })
})
```

Create `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts` with a fake runtime dependency that resolves `core.swarm-task` and asserts `startRun` is called.

- [ ] **Step 2: Run workflow node tests to verify they fail**

Run: `pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`

Expected: FAIL because workflow node files do not exist.

- [ ] **Step 3: Implement workflow schema**

Create `desktop/app-capabilities/swarm-task/workflow-node/schema.ts`:

```ts
import { z } from "zod"
import { swarmRunModeSchema } from "../shared/schema"

export const swarmTaskNodeConfigSchema = z.object({
  taskId: z.string().min(1),
  promptOverride: z.string().min(1).optional(),
  runModeOverride: swarmRunModeSchema.optional(),
  maxRoundsOverride: z.number().int().min(1).max(500).optional(),
  concurrencyOverride: z.number().int().min(1).max(20).optional(),
  waitForCompletion: z.boolean().default(false),
}).strict()

export type SwarmTaskNodeConfig = z.infer<typeof swarmTaskNodeConfigSchema>
```

- [ ] **Step 4: Implement manifest, executor, panel, and card**

Use existing app capability workflow node patterns. Manifest title: `蜂群任务`. Node type: `SWARM_TASK_WORKFLOW_NODE_TYPE`. Ports: one input and one output. Card subtitle should show the task id when no task name is available.

Executor logic:

```ts
const run = await service.startRun({
  taskId: input.config.taskId,
  configOverride: buildConfigOverride(input.config),
})
if (!input.config.waitForCompletion) {
  return { status: "success", output: run.id, outputs: { runId: run.id, status: run.status, totals: run.totals, outputDirectory: run.outputDirectory }, durationMs }
}
poll service.getRun(run.id) until terminal status or workflow cancellation
```

Use terminal statuses: `success`, `partial`, `failed`, `cancelled`.

- [ ] **Step 5: Register workflow node**

Modify `desktop/workflow-nodes/register.main.ts`:

```ts
import { swarmTaskNodeManifest } from "../app-capabilities/swarm-task/workflow-node/manifest"
import { swarmTaskNodeExecutor } from "../app-capabilities/swarm-task/workflow-node/executor.main"
nodeTypeRegistry.register(swarmTaskNodeManifest, swarmTaskNodeExecutor)
```

Modify `desktop/workflow-nodes/register.renderer.ts`:

```ts
import { swarmTaskNodeManifest } from "../app-capabilities/swarm-task/workflow-node/manifest"
nodeTypeRegistry.registerManifest(swarmTaskNodeManifest)
```

Modify `desktop/workflow-nodes/panel-registry.ts`:

```ts
import { SwarmTaskNodePanel } from "../app-capabilities/swarm-task/workflow-node/panel"
["swarm_task_run", SwarmTaskNodePanel as unknown as PanelComponent],
```

- [ ] **Step 6: Run workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts desktop/workflow-nodes/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/swarm-task/workflow-node desktop/workflow-nodes/register.main.ts desktop/workflow-nodes/register.renderer.ts desktop/workflow-nodes/panel-registry.ts desktop/workflow-nodes/__tests__/registry.test.ts
git commit -m "feat: add swarm task workflow node"
```

---

### Task 10: Built-In Skill Docs, Release Notes, And Final Verification

**Files:**
- Modify: `desktop/resources/templates/skills/synapse-skill/files/automation/index.md`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: existing focused tests from Tasks 1-9.

**Interfaces:**
- Consumes: MCP tool names and schemas from Task 8.
- Produces: user-facing release note and built-in skill reference for Agent use.

- [ ] **Step 1: Inspect current synapse-skill domain docs**

Run:

```bash
find desktop/resources/templates/skills/synapse-skill/files -maxdepth 2 -type f | sort
sed -n '1,220p' desktop/resources/templates/skills/synapse-skill/files/automation/index.md
sed -n '1,260p' desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md
```

Expected: files exist. Update these two automation-domain files for the Swarm Task MCP capability because the app is a reusable automation-style Agent runner. Do not create an old-style independent `synapse-*-mcp` skill.

- [ ] **Step 2: Update built-in skill docs**

Add concise tool documentation for:

```text
app_swarm_task_task_create
app_swarm_task_task_list
app_swarm_task_task_get
app_swarm_task_task_update
app_swarm_task_task_delete
app_swarm_task_run_start
app_swarm_task_run_stopRefill
app_swarm_task_run_cancel
app_swarm_task_run_list
app_swarm_task_run_get
```

Include:

```text
- Use Swarm Task when the user wants reusable multi-Agent prompt runs.
- Do not use it for direct terminal control.
- Worker details live in linked Agent conversations with platform "swarm".
- Every run snapshots task config.
```

- [ ] **Step 3: Update release notes**

Modify `RELEASE_NOTES_PENDING.md` with one user-facing bullet:

```markdown
- 新增“蜂群任务”系统应用：可以保存可复用的多 Agent 任务配置，按固定批次或连续补位运行，并在任务详情里查看 worker 状态、历史运行和对应 Agent 对话。
```

- [ ] **Step 4: Run focused verification**

Run:

```bash
pnpm --filter @synapse/desktop test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts desktop/app-capabilities/swarm-task/main/__tests__/ipc.test.ts desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts desktop/src/modules/agent/__tests__/conversation-source.test.ts desktop/electron/modules/agent/__tests__/ipc-sessions.test.ts desktop/electron/__tests__/preload.test.ts desktop/workflow-nodes/__tests__/registry.test.ts desktop/src/modules/apps/__tests__/registry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Run typecheck**

Run: `pnpm --filter @synapse/desktop run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/resources/templates/skills/synapse-skill/files/automation/index.md desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs: document swarm task app"
```

---

## Self-Review

- Spec coverage: tasks cover ability package structure, DataRepository schemas, Prompt Summary/Handoff protocol, scheduler modes, Agent Runtime side sessions, conversation source, UI, MCP dispatcher, Workflow node, built-in skill docs, and release notes.
- Scope check: the feature spans UI, main service, MCP, and Workflow, but all pieces belong to one system app capability and can be delivered incrementally by the task order above.
- Placeholder scan: no `TBD`, `TODO`, or "implement later" markers are intentionally present in this plan.
- Type consistency: `SwarmTask`, `SwarmRun`, `SwarmWorkerRun`, `SwarmTaskConfig`, `SwarmAgentGateway`, and `SwarmTaskService` names are consistent across tasks.
