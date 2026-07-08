# Swarm Task Config Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simplify Swarm Task configuration so the selected project is the only workspace, file-related behavior is an optional summary-file prompt injection, and Git/output controls disappear from the user-facing form.

**Architecture:** Move workspace resolution into the main Swarm Task service via a `resolveProjectPath(projectId)` dependency. Replace the old output protocol with a `summaryFile` config block and prompt section. Keep renderer changes scoped to the Swarm Task config form while preserving run scheduling, worker conversations, MCP routing, and Workflow node behavior.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vite 8, Vitest, shadcn/ui, Tailwind CSS 4, Zod.

## Global Constraints

- No new runtime output manager, no new file merge system, and no new dependency.
- Worker always runs in the selected project's path; users cannot configure `workspacePath`.
- Summary file behavior is prompt injection only; the app does not create, merge, or guarantee file writes.
- Git context is removed from the UI and prompt injection.
- UI uses existing shadcn/Tailwind tokens and shared components; no custom colors, inline styles, decorative gradients, nested cards, or marketing copy.
- Complete user-visible changes require updating `RELEASE_NOTES_PENDING.md`.
- If shared schema or capability input shape changes, update Swarm Task MCP docs, Workflow integration, and tests.

---

## File Structure

- `desktop/app-capabilities/swarm-task/shared/schema.ts`
  - Owns the simplified `SwarmTaskConfig` shape, legacy config normalization, and summary-file validation.
- `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`
  - Replaces old output protocol injection with a summary-file-only prompt section.
- `desktop/app-capabilities/swarm-task/main/service.ts`
  - Resolves selected project path for task creation, task update, run snapshots, Agent Runtime gateway calls, and summary file path validation.
- `desktop/electron/bootstrap/descriptors.ts`
  - Wires `resolveProjectPath(projectId)` from `configStore.load()`.
- `desktop/app-capabilities/swarm-task/renderer/index.tsx`
  - Removes repository directory chooser dependency and creates default configs without `workspacePath`.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`
  - Rebuilds the config form into the approved groups and adds the summary-file controls.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx`
  - Removes workspace/output display from overview and drops obsolete props.
- `desktop/app-capabilities/swarm-task/renderer/swarm-task-format.ts`
  - Removes output formatting if unused after the UI change.
- `desktop/app-capabilities/swarm-task/workflow-node/*`
  - Keeps existing overrides but compiles against the simplified shared config.
- `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
  - Updates Swarm Task examples and removes `workspacePath`, output mode, target-file policy, and Git context.
- `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`
  - Updates schema examples and invalid cases.
- `desktop/app-capabilities/swarm-task/**/__tests__/*`
  - Adds focused coverage for schema normalization, prompt injection, service path resolution, and renderer form behavior.
- `RELEASE_NOTES_PENDING.md`
  - Adds one user-facing note for the simplified Swarm Task configuration.

---

### Task 1: Shared Config Schema And Legacy Normalization

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/shared/schema.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`

**Interfaces:**
- Produces: `swarmSummaryFileConfigSchema`, `SwarmSummaryFileConfig`, simplified `SwarmTaskConfig`.
- Produces: `normalizeSwarmTaskConfig(input: unknown): SwarmTaskConfig` for service, renderer test fixtures, and future migration-safe parsing.
- Consumes: existing Zod schema export pattern from `swarmTaskConfigSchema`.

- [ ] **Step 1: Write failing schema tests**

Add these cases to `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`:

```ts
it("validates the simplified config without workspace or output fields", () => {
  const entry = {
    id: "task-1",
    schemaVersion: 1,
    name: "巡检",
    currentConfig: {
      projectId: "project-1",
      prompt: "Run the task.",
      presetId: "general",
      injectOptions: {
        workerIdentity: true,
        roundContext: true,
        runContext: true,
        parallelContext: true,
        customAppendix: "",
      },
      runMode: "continuous",
      concurrency: 3,
      maxRounds: 9,
      summary: {
        enabled: true,
        injectRecent: true,
        recentLimit: 3,
      },
      handoff: {
        enabled: false,
      },
      summaryFile: {
        enabled: true,
        path: "reports/swarm.md",
      },
      agent: {
        providerId: "provider-1",
        modelTier: "default",
        permissionMode: "default",
        mainThreadPersonaId: null,
      },
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  }

  expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(true)
})

it("normalizes legacy output target files to summaryFile", () => {
  const config = normalizeSwarmTaskConfig({
    ...baseConfig,
    output: {
      mode: "target-file",
      targetFile: "reports/legacy.md",
      targetFilePolicy: "append-only",
    },
  })

  expect(config.summaryFile).toEqual({
    enabled: true,
    path: "reports/legacy.md",
  })
  expect("workspacePath" in config).toBe(false)
  expect("output" in config).toBe(false)
  expect(config.injectOptions).not.toHaveProperty("gitContext")
})

it("rejects summary file paths outside the project", () => {
  const entry = {
    id: "task-1",
    schemaVersion: 1,
    name: "bad",
    currentConfig: {
      ...normalizeSwarmTaskConfig(baseConfig),
      summaryFile: { enabled: true, path: "../outside.md" },
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  }

  expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(false)
})
```

Add this import at the top:

```ts
import { normalizeSwarmTaskConfig } from "../../../../app-capabilities/swarm-task/shared/schema"
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: FAIL because `normalizeSwarmTaskConfig` and `summaryFile` do not exist and old schema still requires `workspacePath`.

- [ ] **Step 3: Implement schema changes**

In `desktop/app-capabilities/swarm-task/shared/schema.ts`, remove the public output enums and replace `swarmInjectOptionsSchema`, default helpers, and `swarmTaskConfigSchema` with:

```ts
export const swarmSummaryFileConfigSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().max(4096).optional().default(""),
}).strict().superRefine((value, ctx) => {
  const path = value.path.trim()
  if (value.enabled && !path) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "summary file path is required",
    })
    return
  }
  if (path.startsWith("/") || path.match(/^[A-Za-z]:[\\/]/) || path.split(/[\\/]+/).includes("..")) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "summary file path must stay inside the project",
    })
  }
})

export const swarmInjectOptionsSchema = z.object({
  workerIdentity: z.boolean().default(true),
  roundContext: z.boolean().default(true),
  runContext: z.boolean().default(true),
  parallelContext: z.boolean().default(true),
  customAppendix: z.string().max(16 * 1024).optional().default(""),
}).strict()

const defaultSwarmInjectOptions = () => ({
  workerIdentity: true,
  roundContext: true,
  runContext: true,
  parallelContext: true,
  customAppendix: "",
})

const defaultSwarmSummaryFileConfig = () => ({
  enabled: false,
  path: "",
})

export const swarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: swarmInjectOptionsSchema.default(defaultSwarmInjectOptions),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  summary: swarmSummaryConfigSchema.default(defaultSwarmSummaryConfig),
  handoff: swarmHandoffConfigSchema.default(defaultSwarmHandoffConfig),
  summaryFile: swarmSummaryFileConfigSchema.default(defaultSwarmSummaryFileConfig),
  agent: swarmAgentConfigSchema.default({}),
}).strict()
```

Add the legacy parser below `swarmTaskConfigSchema`:

```ts
const legacySwarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  workspacePath: z.string().min(1).optional(),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: z.object({
    workerIdentity: z.boolean().default(true),
    roundContext: z.boolean().default(true),
    runContext: z.boolean().default(true),
    outputProtocol: z.boolean().optional(),
    parallelContext: z.boolean().default(true),
    gitContext: z.boolean().optional(),
    customAppendix: z.string().max(16 * 1024).optional().default(""),
  }).passthrough().default(defaultSwarmInjectOptions),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  output: z.object({
    mode: z.enum(["managed-directory", "target-file", "both"]).default("managed-directory"),
    managedDirectory: z.string().min(1).optional(),
    targetFile: z.string().min(1).optional(),
    targetFilePolicy: z.enum(["append-only", "section-update", "free-edit"]).default("append-only"),
  }).optional(),
  summary: swarmSummaryConfigSchema.default(defaultSwarmSummaryConfig),
  handoff: swarmHandoffConfigSchema.default(defaultSwarmHandoffConfig),
  summaryFile: swarmSummaryFileConfigSchema.optional(),
  agent: swarmAgentConfigSchema.default({}),
}).passthrough()

export function normalizeSwarmTaskConfig(input: unknown): SwarmTaskConfig {
  const direct = swarmTaskConfigSchema.safeParse(input)
  if (direct.success) return direct.data

  const legacy = legacySwarmTaskConfigSchema.parse(input)
  const legacyTargetFile = legacy.output?.targetFile?.trim()
  const summaryFile = legacy.summaryFile ?? (
    legacyTargetFile && (legacy.output?.mode === "target-file" || legacy.output?.mode === "both")
      ? { enabled: true, path: legacyTargetFile }
      : { enabled: false, path: "" }
  )

  return swarmTaskConfigSchema.parse({
    projectId: legacy.projectId,
    prompt: legacy.prompt,
    presetId: legacy.presetId,
    injectOptions: {
      workerIdentity: legacy.injectOptions.workerIdentity,
      roundContext: legacy.injectOptions.roundContext,
      runContext: legacy.injectOptions.runContext,
      parallelContext: legacy.injectOptions.parallelContext,
      customAppendix: legacy.injectOptions.customAppendix,
    },
    runMode: legacy.runMode,
    concurrency: legacy.concurrency,
    maxRounds: legacy.maxRounds,
    summary: legacy.summary,
    handoff: legacy.handoff,
    summaryFile,
    agent: legacy.agent,
  })
}
```

Update `swarmTaskCreateInputSchema`, `swarmTaskUpdateInputSchema`, `swarmTaskSchema`, `swarmRunSchema`, and `swarmRunStartInputSchema` to use `z.preprocess(normalizeSwarmTaskConfig, swarmTaskConfigSchema)` where they parse full configs or partial overrides. For `configOverride`, keep `swarmTaskConfigSchema.partial()` but omit removed fields.

Export the new type:

```ts
export type SwarmSummaryFileConfig = z.infer<typeof swarmSummaryFileConfigSchema>
```

- [ ] **Step 4: Run schema tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add desktop/app-capabilities/swarm-task/shared/schema.ts desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
git commit -m "refactor: simplify swarm task config schema"
```

---

### Task 2: Service Path Resolution And Prompt Injection

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/service.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`
- Modify: `desktop/electron/bootstrap/descriptors.ts`

**Interfaces:**
- Consumes: `normalizeSwarmTaskConfig(input)` and `SwarmTaskConfig.summaryFile`.
- Produces: `resolveProjectPath(projectId: string): Promise<string>` service dependency.
- Produces: prompt section `## Summary File` when summary file injection is enabled.

- [ ] **Step 1: Write failing prompt-builder tests**

Update `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts` config fixtures to remove `workspacePath`, `output`, `outputProtocol`, and `gitContext`; add:

```ts
summaryFile: {
  enabled: true,
  path: "reports/swarm.md",
},
```

Replace output/Git assertions in the stable-order test with:

```ts
expect(prompt.indexOf("## Previous Handoff")).toBeLessThan(prompt.indexOf("## Summary File"))
expect(prompt.indexOf("## Summary File")).toBeLessThan(prompt.indexOf("## Parallel Coordination"))
expect(prompt).toContain("reports/swarm.md")
expect(prompt).toContain("不要覆盖已有内容")
expect(prompt).not.toContain("## Output Protocol")
expect(prompt).not.toContain("Write policy")
expect(prompt).not.toContain("If you use git")
```

Add:

```ts
it("omits summary file instructions when disabled", () => {
  const prompt = buildSwarmWorkerPrompt({
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    config: {
      ...config,
      summaryFile: { enabled: false, path: "" },
    },
    recentSummaries,
  })

  expect(prompt).not.toContain("## Summary File")
  expect(prompt).not.toContain("reports/swarm.md")
})
```

- [ ] **Step 2: Write failing service tests**

In `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`, update the base config fixture to remove `workspacePath`, `output`, `outputProtocol`, and `gitContext`; add `summaryFile: { enabled: false, path: "" }`.

Extend `serviceHarness`:

```ts
function serviceHarness(options?: {
  agent?: Partial<SwarmAgentGateway>
  eventBus?: { emit: ReturnType<typeof vi.fn> }
  workers?: ReturnType<typeof namespace<SwarmWorkerRun>>
  resolveProjectPath?: (projectId: string) => Promise<string>
}) {
  const resolveProjectPath = vi.fn(options?.resolveProjectPath ?? (async (projectId: string) => {
    if (projectId === "project-1") return "/repo"
    throw new Error("项目不可用")
  }))
  const service = createSwarmTaskService({
    tasks,
    runs,
    workers,
    agent: gateway,
    eventBus: options?.eventBus,
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    idFactory: (() => {
      let index = 0
      return () => `id-${++index}`
    })(),
    outputRoot: "/repo/swarm-runs",
    resolveProjectPath,
  } as never)
  return { service, tasks, runs, workers, gateway, resolveProjectPath }
}
```

Add:

```ts
it("starts Agent workers in the selected project path", async () => {
  const { service, gateway, resolveProjectPath } = serviceHarness()
  const task = await service.createTask({ name: "任务", config })

  await service.startRun({ taskId: task.id })
  await vi.waitFor(() => {
    expect(gateway.sendWorker).toHaveBeenCalled()
  })

  expect(resolveProjectPath).toHaveBeenCalledWith("project-1")
  const firstCall = vi.mocked(gateway.sendWorker).mock.calls[0]?.[0]
  expect(firstCall?.workspacePath).toBe("/repo")
})

it("rejects runs for missing projects before workers start", async () => {
  const { service, gateway } = serviceHarness({
    resolveProjectPath: async () => {
      throw new Error("项目不可用")
    },
  })
  const task = await service.createTask({ name: "任务", config })

  await expect(service.startRun({ taskId: task.id })).rejects.toThrow("项目不可用")
  expect(gateway.sendWorker).not.toHaveBeenCalled()
})
```

These tests require `SwarmAgentGatewayInput` to include `workspacePath`.

- [ ] **Step 3: Run focused tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
```

Expected: FAIL because service dependency and summary-file prompt section are not implemented.

- [ ] **Step 4: Implement prompt builder**

In `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`, remove `outputProtocolSection` and all `gitContext` handling. Add:

```ts
function summaryFileSection(config: SwarmTaskConfig): string {
  const path = config.summaryFile.path.trim()
  if (!config.summaryFile.enabled || !path) return ""
  return [
    "## Summary File",
    "如果本轮任务需要写入总结性结果，请追加到以下项目文件：",
    path,
    "",
    "不要覆盖已有内容。追加前保留文件原有内容。",
  ].join("\n")
}
```

Update `buildSwarmWorkerPrompt` section order:

```ts
const summaryFile = summaryFileSection(input.config)
if (summaryFile) sections.push(summaryFile)

if (inject.parallelContext || inject.customAppendix?.trim()) {
  sections.push(parallelContextSection(input.config))
}
```

Update `runtimeContextSection` so it no longer pushes `Workspace`.

Update `parallelContextSection`:

```ts
function parallelContextSection(config: SwarmTaskConfig): string {
  const lines = ["## Parallel Coordination"]
  if (config.injectOptions.parallelContext) {
    lines.push("- Multiple workers may run in the same project. Avoid overwriting unrelated user or worker changes.")
  }
  const custom = config.injectOptions.customAppendix?.trim()
  if (custom) lines.push(custom)
  return lines.join("\n")
}
```

- [ ] **Step 5: Implement service path resolution**

In `desktop/app-capabilities/swarm-task/main/service.ts`, update types:

```ts
export type SwarmAgentGatewayInput = {
  readonly task: SwarmTask
  readonly run: SwarmRun
  readonly worker: SwarmWorkerRun
  readonly prompt: string
  readonly workspacePath: string
  readonly abortSignal?: AbortSignal
  readonly onConversationId?: (conversationId: string) => Promise<void> | void
}

export type SwarmTaskServiceDeps = {
  readonly tasks: Pick<DataNamespace<SwarmTask>, "list" | "get" | "upsert" | "remove">
  readonly runs: Pick<DataNamespace<SwarmRun>, "list" | "get" | "upsert" | "remove">
  readonly workers: Pick<DataNamespace<SwarmWorkerRun>, "list" | "get" | "upsert" | "remove">
  readonly agent: SwarmAgentGateway
  readonly resolveProjectPath: (projectId: string) => Promise<string>
  readonly outputRoot: string
  readonly eventBus?: Pick<EventBus, "emit">
  readonly now?: () => Date
  readonly idFactory?: () => string
}
```

Update `createAgentRuntimeSwarmGateway` to send:

```ts
workspacePath: input.workspacePath,
```

Update `startRun` before creating `SwarmRun`:

```ts
const workspacePath = await deps.resolveProjectPath(configSnapshot.projectId)
```

Keep `outputDirectory` internal if existing history depends on it, but no longer derive it from config:

```ts
outputDirectory: path.join(deps.outputRoot, runId),
```

Pass `workspacePath` to scheduler runner by resolving it inside `createWorkerRunner`:

```ts
const workspacePath = await deps.resolveProjectPath(run.configSnapshot.projectId)
const result = await deps.agent.sendWorker({
  task,
  run,
  worker,
  prompt,
  workspacePath,
  abortSignal: input.abortSignal,
  onConversationId: (conversationId) => persistWorkerConversationId(worker.id, conversationId),
})
```

Use `normalizeSwarmTaskConfig` in `createTask`, `updateTask`, and `mergeConfigSnapshot` so legacy stored data and MCP callers normalize before persistence.

- [ ] **Step 6: Wire project path resolver in bootstrap**

In `desktop/electron/bootstrap/descriptors.ts`, add `resolveProjectPath` to `createSwarmTaskService`:

```ts
resolveProjectPath: async (projectId) => {
  const config = await configStore.load()
  const project = config.global.projects.find((item) => item.id === projectId)
  if (!project) {
    throw new Error("项目不可用")
  }
  return project.path
},
```

- [ ] **Step 7: Run focused tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/service.ts desktop/app-capabilities/swarm-task/main/prompt-builder.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts desktop/electron/bootstrap/descriptors.ts
git commit -m "refactor: resolve swarm task workspace from project"
```

---

### Task 3: Renderer Config Form Simplification

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/renderer/index.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/swarm-task-format.ts`
- Modify: `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-format.test.ts`

**Interfaces:**
- Consumes: simplified `SwarmTaskConfig` and `summaryFile`.
- Produces: renderer config form groups `任务`, `运行`, `上下文`, `汇总文件`.
- Produces: no renderer dependency on `repositoryBridge.chooseDirectory`.

- [ ] **Step 1: Write failing renderer tests**

In `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`, update fixtures to simplified configs. Remove `repositoryBridge` mock and tests for custom run directory.

Replace `it("updates the run directory when selecting another project"...` with:

```ts
it("selects a project without exposing a run directory", async () => {
  await renderModule()
  await clickTab("配置")

  await selectOption("项目：项目一", "项目二")

  expect(document.body.textContent).not.toContain("运行目录")
  expect(document.querySelector("[aria-label='运行目录']")).toBeNull()
  expect(swarmTaskBridge.updateTask).not.toHaveBeenCalled()
})
```

Replace output menu test with:

```ts
it("shows grouped config fields and summary file controls", async () => {
  await renderModule()
  await clickTab("配置")

  expect(document.body.textContent).toContain("任务")
  expect(document.body.textContent).toContain("运行")
  expect(document.body.textContent).toContain("上下文")
  expect(document.body.textContent).toContain("汇总文件")
  expect(document.body.textContent).toContain("写入汇总文件")
  expect(document.body.textContent).not.toContain("输出")
  expect(document.body.textContent).not.toContain("Git 上下文")
  expect(document.body.textContent).not.toContain("目录 + 文件")
})

it("requires a summary file path when summary file injection is enabled", async () => {
  await renderModule()
  await clickTab("配置")

  await clickSwitch("写入汇总文件")

  expect((await waitForButton("保存配置")).disabled).toBe(true)
  expect((await waitForButton("运行任务")).disabled).toBe(true)

  await setInputValue(await waitForInput("汇总文件路径"), "reports/swarm.md")

  expect((await waitForButton("保存配置")).disabled).toBe(false)
  expect((await waitForButton("运行任务")).disabled).toBe(false)
})
```

If no `clickSwitch` helper exists, add:

```ts
async function clickSwitch(label: string) {
  const control = await waitFor(() => {
    const element = document.querySelector(`[aria-label="${label}"]`)
    if (!(element instanceof HTMLElement)) throw new Error(`Missing switch: ${label}`)
    return element
  })
  await act(async () => {
    control.click()
  })
}
```

Update creation expectation:

```ts
expect(swarmTaskBridge.createTask).toHaveBeenCalledWith({
  name: defaultName,
  config: {
    projectId: "project-1",
    prompt: "填写任务目标",
    presetId: "general",
    injectOptions: {
      workerIdentity: true,
      roundContext: true,
      runContext: true,
      parallelContext: true,
      customAppendix: "",
    },
    runMode: "batch",
    concurrency: 1,
    maxRounds: 1,
    summary: { enabled: true, injectRecent: false, recentLimit: 3 },
    handoff: { enabled: false },
    summaryFile: { enabled: false, path: "" },
    agent: {},
  },
})
```

- [ ] **Step 2: Run renderer test and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx
```

Expected: FAIL because old controls still render and config still includes workspace/output/Git fields.

- [ ] **Step 3: Update renderer defaults and validation**

In `desktop/app-capabilities/swarm-task/renderer/index.tsx`, remove `FolderOpen`/repository bridge usage and change defaults:

```ts
const baseTaskConfig: Omit<SwarmTaskConfig, "projectId"> = {
  prompt: "填写任务目标",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    parallelContext: true,
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 1,
  maxRounds: 1,
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  summaryFile: { enabled: false, path: "" },
  agent: {},
}
```

Change runnable validation:

```ts
const summaryFileReady = !draftConfig?.summaryFile.enabled || Boolean(draftConfig.summaryFile.path.trim())
const draftConfigIsRunnable = useMemo(() => (
  Boolean(draftConfig?.prompt.trim())
  && Boolean(draftConfig?.projectId)
  && projects.some((project) => project.id === draftConfig?.projectId)
  && summaryFileReady
), [draftConfig, projects, summaryFileReady])
```

Remove `chooseWorkspacePath` and the `onChooseWorkspacePath` prop.

Update `createDefaultTaskConfig`:

```ts
function createDefaultTaskConfig(project: SynapseProjectConfig): SwarmTaskConfig {
  return {
    ...baseTaskConfig,
    projectId: project.id,
  }
}
```

- [ ] **Step 4: Rebuild the config form groups**

In `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`:

Remove imports:

```ts
import { useState } from "react"
import { Check, ChevronDown, FolderOpen } from "lucide-react"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "../../../../src/components/ui/input-group"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "../../../../src/components/ui/hover-card"
import { Separator } from "../../../../src/components/ui/separator"
```

Keep `Check` and `ChevronDown` only if the described menu remains for run mode. Add the explicit type import:

```ts
import type { ReactNode } from "react"
```

Change props:

```ts
type SwarmTaskConfigFormProps = {
  readonly value: SwarmTaskConfig
  readonly projects: readonly SynapseProjectConfig[]
  readonly onChange: (next: SwarmTaskConfig) => void
}
```

Remove `outputModeOptions`, `DescribedOptionMenu` usage for output, and `Git 上下文`.

Use group sections:

```tsx
<FieldGroup className="mx-auto grid w-full max-w-3xl gap-6 px-3 pb-3 sm:px-5 sm:pb-5">
  <ConfigSection title="任务">
    {/* 任务目标 + 项目 */}
  </ConfigSection>
  <ConfigSection title="运行">
    {/* 运行模式 + 并发 + 轮次 */}
  </ConfigSection>
  <ConfigSection title="上下文">
    {/* 摘要 + 最近摘要 + 交接 */}
  </ConfigSection>
  <ConfigSection title="汇总文件">
    <SwitchField
      label="写入汇总文件"
      checked={value.summaryFile.enabled}
      onCheckedChange={(checked) => onChange({
        ...value,
        summaryFile: {
          enabled: checked,
          path: value.summaryFile.path,
        },
      })}
    />
    {value.summaryFile.enabled ? (
      <Field className="grid gap-2">
        <FieldLabel htmlFor="swarm-task-summary-file">汇总文件路径</FieldLabel>
        <FieldContent>
          <Input
            id="swarm-task-summary-file"
            aria-label="汇总文件路径"
            value={value.summaryFile.path}
            onChange={(event) => onChange({
              ...value,
              summaryFile: { ...value.summaryFile, path: event.target.value },
            })}
          />
          <p className="text-xs text-muted-foreground">需要写总结文件时追加到此文件。</p>
        </FieldContent>
      </Field>
    ) : null}
  </ConfigSection>
</FieldGroup>
```

Add helper:

```tsx
function ConfigSection({
  title,
  children,
}: {
  readonly title: string
  readonly children: ReactNode
}) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <div className="grid min-w-0 gap-4">{children}</div>
    </section>
  )
}
```

When changing project selection, only update `projectId`:

```ts
onChange({ ...value, projectId: project.id })
```

- [ ] **Step 5: Update overview and formatter**

In `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx`, remove:

```ts
formatOutputMode
onChooseWorkspacePath
["运行目录", config.workspacePath]
["输出", formatOutputMode(config.output.mode)]
```

Show summary file only when enabled:

```ts
...(config.summaryFile.enabled
  ? [["汇总文件", config.summaryFile.path]] as ReadonlyArray<readonly [string, string]>
  : []),
```

Remove `formatOutputMode` from `desktop/app-capabilities/swarm-task/renderer/swarm-task-format.ts` and its test expectations if no longer used.

- [ ] **Step 6: Run renderer tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-format.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add desktop/app-capabilities/swarm-task/renderer/index.tsx desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx desktop/app-capabilities/swarm-task/renderer/components/swarm-task-detail.tsx desktop/app-capabilities/swarm-task/renderer/swarm-task-format.ts desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-format.test.ts
git commit -m "refactor: simplify swarm task config form"
```

---

### Task 4: MCP, Workflow, Docs, And Release Notes

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`
- Modify: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`

**Interfaces:**
- Consumes: simplified shared schema from Task 1.
- Produces: updated MCP examples and Workflow tests that do not mention removed config fields.

- [ ] **Step 1: Update MCP dispatcher tests**

In `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`, replace any config fixture with:

```ts
const config = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    parallelContext: true,
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  summaryFile: { enabled: false, path: "" },
  agent: {},
}
```

Add an assertion in task create/update tests:

```ts
expect(JSON.stringify(result.data)).not.toContain("workspacePath")
expect(JSON.stringify(result.data)).not.toContain("gitContext")
expect(JSON.stringify(result.data)).not.toContain("targetFilePolicy")
```

- [ ] **Step 2: Update Workflow tests**

In Workflow node test fixtures under `desktop/app-capabilities/swarm-task/workflow-node/__tests__/`, update `SwarmRun.configSnapshot` fixtures to the simplified config. Keep `configOverride` tests limited to `prompt`, `runMode`, `maxRounds`, and `concurrency`.

Use this base snapshot:

```ts
const configSnapshot = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  injectOptions: {
    workerIdentity: true,
    roundContext: true,
    runContext: true,
    parallelContext: true,
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  summary: { enabled: true, injectRecent: false, recentLimit: 3 },
  handoff: { enabled: false },
  summaryFile: { enabled: false, path: "" },
  agent: {},
}
```

- [ ] **Step 3: Run MCP and Workflow tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts
```

Expected: PASS after fixtures and schema expectations are updated.

- [ ] **Step 4: Update built-in Synapse skill API docs**

In `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`, replace the Swarm Task create example config with:

```json
{
  "name": "Research candidates",
  "description": "Optional description",
  "config": {
    "projectId": "project-id",
    "prompt": "Find and summarize candidate approaches.",
    "presetId": "general",
    "runMode": "batch",
    "concurrency": 3,
    "maxRounds": 3,
    "injectOptions": {
      "workerIdentity": true,
      "roundContext": true,
      "runContext": true,
      "parallelContext": true,
      "customAppendix": ""
    },
    "summary": {
      "enabled": true,
      "injectRecent": false,
      "recentLimit": 3
    },
    "handoff": {
      "enabled": false
    },
    "summaryFile": {
      "enabled": false,
      "path": ""
    },
    "agent": {}
  }
}
```

Replace the explanatory sentence after the example with:

```md
Returns the saved task. `runMode` is `batch` or `continuous`. `concurrency` is 1-20. `maxRounds` is 1-500. Workers run in the selected project path. `summaryFile` only injects an append instruction into worker prompts; Synapse does not merge or guarantee file writes.
```

Remove mentions of output `mode`, target file policy, `workspacePath`, and `gitContext` from the Swarm Task section.

- [ ] **Step 5: Update release notes**

Add one bullet under the appropriate pending section in `RELEASE_NOTES_PENDING.md`:

```md
- 简化蜂群任务配置：项目即运行位置，移除运行目录、输出模式和 Git 上下文，改为可选的汇总文件追加提示。
```

- [ ] **Step 6: Commit**

```bash
git add desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs: update swarm task simplified config surfaces"
```

---

### Task 5: Full Verification And Cleanup

**Files:**
- Inspect: all modified Swarm Task files
- Modify only if verification finds issues

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified working tree ready for final review or PR.

- [ ] **Step 1: Run all Swarm Task tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run desktop typecheck**

Run:

```bash
pnpm --filter @synapse/desktop run typecheck
```

Expected: PASS.

- [ ] **Step 3: Scan removed labels and fields**

Run:

```bash
rg -n "运行目录|Git 上下文|目录 \\+ 文件|targetFilePolicy|gitContext|outputProtocol|workspacePath" desktop/app-capabilities/swarm-task desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md
```

Expected: No user-facing UI or docs references remain. The only acceptable matches are legacy normalization code, tests that explicitly assert migration from old config, or Agent Runtime message fields named `workspacePath`.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD
git diff -- desktop/app-capabilities/swarm-task desktop/electron/bootstrap/descriptors.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
```

Expected: Diff only touches planned files and contains no unrelated refactors.

- [ ] **Step 5: Commit cleanup if needed**

If Step 1-4 required fixes, commit them:

```bash
git add desktop/app-capabilities/swarm-task desktop/electron/bootstrap/descriptors.ts desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "fix: finish swarm task config simplification"
```

If no fixes were needed, do not create an empty commit.
