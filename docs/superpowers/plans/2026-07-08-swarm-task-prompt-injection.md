# Swarm Task Prompt Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework Swarm Task so new tasks default to a pure concurrent executor and all prompt context, handoff, summary, and file writing rules are explicit injection settings.

**Architecture:** Replace the current `injectOptions` / `summary` / `handoff` / `summaryFile` user-facing config with a single `promptInjection` object while preserving legacy normalization for stored tasks and MCP callers. Add stable scheduler metadata (`sequenceIndex`, `slotIndex`, `batchIndex`) and make prompt sections conditional on the new switches. Keep file writing as prompt guidance only, with append-only/update modes and lock instructions, not a Synapse-owned writer.

**Tech Stack:** Electron 41, React 19, TypeScript 6, Vite 8, Vitest, shadcn/ui, Tailwind CSS 4, Zod.

## Global Constraints

- New Swarm Task configs default to pure executor behavior: no sequence, batch, handoff, file writing, or summary protocol injection.
- Swarm Task remains generic; do not encode GitHub issue triage, document review, report generation, or any other business scenario.
- File writing remains prompt injection only; do not implement a managed file merge service.
- No new dependencies.
- UI must use existing shadcn/Radix components and Tailwind tokens only; no custom colors, inline styles, decorative gradients, nested cards, or marketing copy.
- UI copy must stay short and operational.
- Complete user-visible changes require updating `RELEASE_NOTES_PENDING.md`.
- If shared schema or capability input shape changes, update Swarm Task MCP docs, Workflow integration, and tests.

---

## File Structure

- `desktop/app-capabilities/swarm-task/shared/schema.ts`
  - Owns the new `promptInjection` config schema, legacy normalization, config override schema, worker metadata fields, and exported types.
- `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`
  - Verifies new config defaults, legacy migration, path validation, and worker metadata schema compatibility.
- `desktop/app-capabilities/swarm-task/main/scheduler.ts`
  - Computes stable `sequenceIndex`, `slotIndex`, and `batchIndex` for every worker launch.
- `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`
  - Verifies batch and continuous scheduling metadata.
- `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`
  - Builds enabled prompt injection sections only.
- `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`
  - Verifies default omission and every enabled injection section.
- `desktop/app-capabilities/swarm-task/main/service.ts`
  - Persists new worker metadata, selects previous-batch handoff content, stores summary/handoff only when enabled, and merges new config overrides.
- `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
  - Verifies Agent metadata, previous-batch handoff behavior, summary/handoff persistence, and config override merging.
- `desktop/app-capabilities/swarm-task/renderer/index.tsx`
  - Sets pure-executor defaults for newly created tasks.
- `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`
  - Replaces the old context/summary-file controls with `注入` and `文件` groups.
- `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`
  - Verifies defaults, form controls, conditional file controls, and validation.
- `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`
  - Updates MCP dispatcher fixtures to the new config shape.
- `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`
  - Ensures existing workflow override schema still compiles against new shared config types.
- `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`
  - Updates run snapshot fixtures and keeps workflow overrides scoped to prompt/run/concurrency.
- `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
  - Updates Swarm Task MCP examples and semantics.
- `RELEASE_NOTES_PENDING.md`
  - Adds one user-facing note about explicit Swarm prompt injection controls.

---

### Task 1: Shared Schema And Legacy Normalization

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/shared/schema.ts`
- Modify: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`
- Test: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`

**Interfaces:**
- Produces: `swarmPromptInjectionConfigSchema`
- Produces: `swarmFileWriteModeSchema`
- Produces: `normalizeSwarmTaskConfig(input: unknown): SwarmTaskConfig`
- Produces: `type SwarmPromptInjectionConfig`
- Produces: `type SwarmFileWriteMode`
- Produces: `SwarmWorkerRun.sequenceIndex?: number`, `slotIndex?: number`, `batchIndex?: number`
- Consumes: existing `swarmTaskConfigSchema`, `swarmTaskConfigOverrideSchema`, and DataRepository validation flow.

- [ ] **Step 1: Replace schema tests with new config fixtures**

In `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`, replace the current `baseConfig` with this new fixture:

```ts
const baseConfig = {
  projectId: "project-1",
  prompt: "Run the task.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  agent: {
    providerId: "provider-1",
    modelTier: "default",
    permissionMode: "default",
    mainThreadPersonaId: null,
  },
}
```

Add this legacy fixture below it:

```ts
const legacyConfig = {
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
    customAppendix: "Legacy appendix.",
  },
  runMode: "continuous",
  concurrency: 3,
  maxRounds: 9,
  output: {
    mode: "target-file",
    targetFile: "reports/legacy.md",
    targetFilePolicy: "section-update",
  },
  summary: {
    enabled: true,
    injectRecent: true,
    recentLimit: 5,
  },
  handoff: {
    enabled: true,
  },
  agent: {},
}
```

Replace the legacy output tests with these tests:

```ts
it("validates a new pure-executor task config", () => {
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

  expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(true)
})

it("normalizes legacy injection fields to promptInjection", () => {
  const config = normalizeSwarmTaskConfig(legacyConfig)

  expect(config.promptInjection).toEqual({
    sequenceBatch: { enabled: true },
    previousHandoff: { enabled: true },
    summary: { enabled: true, injectRecent: true, recentLimit: 5 },
    fileWrite: {
      enabled: true,
      path: "reports/legacy.md",
      mode: "update",
      lock: { enabled: true },
    },
    customAppendix: "Legacy appendix.",
  })
  expect("workspacePath" in config).toBe(false)
  expect("output" in config).toBe(false)
  expect("injectOptions" in config).toBe(false)
  expect("summaryFile" in config).toBe(false)
  expect("handoff" in config).toBe(false)
})

it("keeps new task defaults as pure executor", () => {
  const config = normalizeSwarmTaskConfig({
    projectId: "project-1",
    prompt: "Run the task.",
  })

  expect(config.promptInjection).toEqual({
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  })
})

it("rejects enabled file write paths outside the project", () => {
  const entry = {
    id: "task-1",
    schemaVersion: 1,
    name: "bad",
    currentConfig: {
      ...baseConfig,
      promptInjection: {
        ...baseConfig.promptInjection,
        fileWrite: {
          enabled: true,
          path: "../outside.md",
          mode: "append-only",
          lock: { enabled: true },
        },
      },
    },
    createdAt: "2026-07-07T00:00:00.000Z",
    updatedAt: "2026-07-07T00:00:00.000Z",
  }

  expect(swarmTaskTasksSchemaDefinition.validate(entry)).toBe(false)
})

it("validates worker run metadata for sequence, slot, and batch", () => {
  const entry = {
    id: "worker-1",
    schemaVersion: 1,
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 2,
    roundIndex: 5,
    sequenceIndex: 5,
    slotIndex: 2,
    batchIndex: 3,
    status: "running",
    conversationId: "conversation-1",
    sessionKey: "swarm:task-1:run-1",
    startedAt: "2026-07-07T00:00:00.000Z",
    lastPhase: "thinking",
    lastMessage: "思考",
  }

  expect(swarmTaskWorkerRunsSchemaDefinition.validate(entry)).toBe(true)
})
```

- [ ] **Step 2: Run schema tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: FAIL with Zod validation errors because `promptInjection` and worker metadata fields are not implemented.

- [ ] **Step 3: Implement prompt injection schemas**

In `desktop/app-capabilities/swarm-task/shared/schema.ts`, replace `swarmInjectOptionsSchema`, `swarmSummaryConfigSchema`, `swarmHandoffConfigSchema`, and `swarmSummaryFileConfigSchema` user-facing usage with these schemas near the top of the file:

```ts
export const swarmFileWriteModeSchema = z.enum(["append-only", "update"])

export const swarmPromptInjectionSequenceBatchSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmPromptInjectionPreviousHandoffSchema = z.object({
  enabled: z.boolean().default(false),
}).strict()

export const swarmPromptInjectionSummarySchema = z.object({
  enabled: z.boolean().default(false),
  injectRecent: z.boolean().default(false),
  recentLimit: z.number().int().min(1).max(20).default(3),
}).strict()

export const swarmPromptInjectionFileWriteSchema = z.object({
  enabled: z.boolean().default(false),
  path: z.string().max(4096).optional().default(""),
  mode: swarmFileWriteModeSchema.default("append-only"),
  lock: z.object({
    enabled: z.boolean().default(true),
  }).strict().default({ enabled: true }),
}).strict().superRefine((value, ctx) => {
  const normalizedPath = value.path.trim()
  if (value.enabled && !normalizedPath) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "file write path is required",
    })
    return
  }
  if (
    normalizedPath.startsWith("/")
    || /^[A-Za-z]:[\\/]/.test(normalizedPath)
    || normalizedPath.split(/[\\/]+/).includes("..")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["path"],
      message: "file write path must stay inside the project",
    })
  }
})

export const swarmPromptInjectionConfigSchema = z.object({
  sequenceBatch: swarmPromptInjectionSequenceBatchSchema.default({ enabled: false }),
  previousHandoff: swarmPromptInjectionPreviousHandoffSchema.default({ enabled: false }),
  summary: swarmPromptInjectionSummarySchema.default({
    enabled: false,
    injectRecent: false,
    recentLimit: 3,
  }),
  fileWrite: swarmPromptInjectionFileWriteSchema.default({
    enabled: false,
    path: "",
    mode: "append-only",
    lock: { enabled: true },
  }),
  customAppendix: z.string().max(16 * 1024).optional().default(""),
}).strict()

const defaultSwarmPromptInjectionConfig = () => ({
  sequenceBatch: { enabled: false },
  previousHandoff: { enabled: false },
  summary: { enabled: false, injectRecent: false, recentLimit: 3 },
  fileWrite: {
    enabled: false,
    path: "",
    mode: "append-only" as const,
    lock: { enabled: true },
  },
  customAppendix: "",
})
```

- [ ] **Step 4: Implement raw and legacy config normalization**

In `desktop/app-capabilities/swarm-task/shared/schema.ts`, replace `swarmTaskConfigRawSchema`, `legacySwarmTaskConfigSchema`, and `normalizeSwarmTaskConfig` with:

```ts
const swarmTaskConfigRawSchema = z.object({
  projectId: z.string().min(1),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  promptInjection: swarmPromptInjectionConfigSchema.default(defaultSwarmPromptInjectionConfig),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  agent: swarmAgentConfigSchema.default({}),
}).strict()

const legacySwarmTaskConfigSchema = z.object({
  projectId: z.string().min(1),
  workspacePath: z.string().min(1).optional(),
  prompt: z.string().min(1).max(256 * 1024),
  presetId: z.string().min(1).default("general"),
  injectOptions: z.object({
    workerIdentity: z.boolean().default(false),
    roundContext: z.boolean().default(false),
    runContext: z.boolean().default(false),
    outputProtocol: z.boolean().optional(),
    parallelContext: z.boolean().default(false),
    gitContext: z.boolean().optional(),
    customAppendix: z.string().max(16 * 1024).optional().default(""),
  }).passthrough().optional(),
  runMode: swarmRunModeSchema.default("batch"),
  concurrency: z.number().int().min(1).max(20).default(3),
  maxRounds: z.number().int().min(1).max(500).default(3),
  output: z.object({
    mode: z.enum(["managed-directory", "target-file", "both"]).default("managed-directory"),
    managedDirectory: z.string().min(1).optional(),
    targetFile: z.string().min(1).optional(),
    targetFilePolicy: z.enum(["append-only", "section-update", "free-edit"]).default("append-only"),
  }).optional(),
  summary: z.object({
    enabled: z.boolean().default(false),
    injectRecent: z.boolean().default(false),
    recentLimit: z.number().int().min(1).max(20).default(3),
  }).strict().optional(),
  handoff: z.object({
    enabled: z.boolean().default(false),
  }).strict().optional(),
  summaryFile: z.object({
    enabled: z.boolean().default(false),
    path: z.string().max(4096).optional().default(""),
  }).strict().optional(),
  agent: swarmAgentConfigSchema.default({}),
}).passthrough()

export function normalizeSwarmTaskConfig(input: unknown): SwarmTaskConfig {
  const direct = swarmTaskConfigRawSchema.safeParse(input)
  if (direct.success) return direct.data

  const legacy = legacySwarmTaskConfigSchema.parse(input)
  const injectOptions = legacy.injectOptions
  const legacyTargetFile = legacy.output?.targetFile?.trim()
  const summaryFilePath = legacy.summaryFile?.path?.trim() || legacyTargetFile || ""
  const fileWriteEnabled = Boolean(
    legacy.summaryFile?.enabled
    || (legacyTargetFile && (legacy.output?.mode === "target-file" || legacy.output?.mode === "both")),
  )

  return swarmTaskConfigRawSchema.parse({
    projectId: legacy.projectId,
    prompt: legacy.prompt,
    presetId: legacy.presetId,
    promptInjection: {
      sequenceBatch: {
        enabled: Boolean(
          injectOptions?.workerIdentity
          || injectOptions?.roundContext
          || injectOptions?.runContext
          || injectOptions?.parallelContext,
        ),
      },
      previousHandoff: { enabled: Boolean(legacy.handoff?.enabled) },
      summary: {
        enabled: Boolean(legacy.summary?.enabled),
        injectRecent: Boolean(legacy.summary?.injectRecent),
        recentLimit: legacy.summary?.recentLimit ?? 3,
      },
      fileWrite: {
        enabled: fileWriteEnabled,
        path: summaryFilePath,
        mode: mapLegacyFileWriteMode(legacy.output?.targetFilePolicy),
        lock: { enabled: true },
      },
      customAppendix: injectOptions?.customAppendix ?? "",
    },
    runMode: legacy.runMode,
    concurrency: legacy.concurrency,
    maxRounds: legacy.maxRounds,
    agent: legacy.agent,
  })
}

function mapLegacyFileWriteMode(value: "append-only" | "section-update" | "free-edit" | undefined): SwarmFileWriteMode {
  if (value === "section-update" || value === "free-edit") return "update"
  return "append-only"
}
```

- [ ] **Step 5: Update config override schema**

In `desktop/app-capabilities/swarm-task/shared/schema.ts`, replace `swarmTaskConfigOverrideSchema` with:

```ts
const swarmPromptInjectionOverrideSchema = z.object({
  sequenceBatch: z.object({
    enabled: z.boolean().optional(),
  }).strict().optional(),
  previousHandoff: z.object({
    enabled: z.boolean().optional(),
  }).strict().optional(),
  summary: z.object({
    enabled: z.boolean().optional(),
    injectRecent: z.boolean().optional(),
    recentLimit: z.number().int().min(1).max(20).optional(),
  }).strict().optional(),
  fileWrite: z.object({
    enabled: z.boolean().optional(),
    path: z.string().max(4096).optional(),
    mode: swarmFileWriteModeSchema.optional(),
    lock: z.object({
      enabled: z.boolean().optional(),
    }).strict().optional(),
  }).strict().optional(),
  customAppendix: z.string().max(16 * 1024).optional(),
}).strict()

const swarmTaskConfigOverrideSchema = z.object({
  projectId: z.string().min(1).optional(),
  prompt: z.string().min(1).max(256 * 1024).optional(),
  presetId: z.string().min(1).optional(),
  promptInjection: swarmPromptInjectionOverrideSchema.optional(),
  runMode: swarmRunModeSchema.optional(),
  concurrency: z.number().int().min(1).max(20).optional(),
  maxRounds: z.number().int().min(1).max(500).optional(),
  agent: swarmAgentConfigSchema.partial().optional(),
}).strict()
```

- [ ] **Step 6: Add worker metadata fields and exports**

In `desktop/app-capabilities/swarm-task/shared/schema.ts`, add these optional fields to `swarmWorkerRunSchema` after `roundIndex`:

```ts
  sequenceIndex: z.number().int().min(1).optional(),
  slotIndex: z.number().int().min(1).optional(),
  batchIndex: z.number().int().min(1).optional(),
```

At the type export block, add:

```ts
export type SwarmFileWriteMode = z.infer<typeof swarmFileWriteModeSchema>
export type SwarmPromptInjectionConfig = z.infer<typeof swarmPromptInjectionConfigSchema>
```

- [ ] **Step 7: Run schema tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit schema work**

Run:

```bash
git add desktop/app-capabilities/swarm-task/shared/schema.ts desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
git commit -m "refactor: add swarm prompt injection schema"
```

---

### Task 2: Scheduler Metadata

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/scheduler.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`
- Test: `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`

**Interfaces:**
- Consumes: `SwarmTaskConfig.promptInjection`
- Produces: `SwarmWorkerRunnerInput.sequenceIndex: number`
- Produces: `SwarmWorkerRunnerInput.slotIndex: number`
- Produces: `SwarmWorkerRunnerInput.batchIndex: number`
- Preserves: `workerIndex` as an alias of `slotIndex` and `roundIndex` as an alias of `sequenceIndex` for compatibility.

- [ ] **Step 1: Update scheduler test fixture**

In `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`, replace the config fixture with:

```ts
const config: SwarmTaskConfig = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 3,
  maxRounds: 3,
  agent: {},
}
```

- [ ] **Step 2: Add failing metadata tests**

In `desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts`, replace the first two tests with:

```ts
it("runs fixed batch workers with stable sequence, slot, and batch metadata", async () => {
  const calls: Array<{
    workerIndex: number
    roundIndex: number
    sequenceIndex: number
    slotIndex: number
    batchIndex: number
  }> = []
  const runner: SwarmWorkerRunner = vi.fn(async (input) => {
    calls.push({
      workerIndex: input.workerIndex,
      roundIndex: input.roundIndex,
      sequenceIndex: input.sequenceIndex,
      slotIndex: input.slotIndex,
      batchIndex: input.batchIndex,
    })
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
    { workerIndex: 1, roundIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1 },
    { workerIndex: 2, roundIndex: 2, sequenceIndex: 2, slotIndex: 2, batchIndex: 1 },
    { workerIndex: 3, roundIndex: 3, sequenceIndex: 3, slotIndex: 3, batchIndex: 1 },
  ])
})

it("refills continuous workers with stable batch metadata", async () => {
  const calls: Array<{
    sequenceIndex: number
    slotIndex: number
    batchIndex: number
  }> = []
  const runner: SwarmWorkerRunner = vi.fn(async (input) => {
    calls.push({
      sequenceIndex: input.sequenceIndex,
      slotIndex: input.slotIndex,
      batchIndex: input.batchIndex,
    })
    return { status: "success", resultText: `round ${input.sequenceIndex}` }
  })
  const scheduler = createSwarmScheduler({ runner })

  const result = await scheduler.start({
    taskId: "task-1",
    runId: "run-1",
    config: { ...config, runMode: "continuous", concurrency: 2, maxRounds: 5 },
  })

  expect(result.status).toBe("success")
  expect(calls.sort((a, b) => a.sequenceIndex - b.sequenceIndex)).toEqual([
    { sequenceIndex: 1, slotIndex: 1, batchIndex: 1 },
    { sequenceIndex: 2, slotIndex: 2, batchIndex: 1 },
    { sequenceIndex: 3, slotIndex: 1, batchIndex: 2 },
    { sequenceIndex: 4, slotIndex: 2, batchIndex: 2 },
    { sequenceIndex: 5, slotIndex: 1, batchIndex: 3 },
  ])
})
```

- [ ] **Step 3: Run scheduler tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts
```

Expected: FAIL because `sequenceIndex`, `slotIndex`, and `batchIndex` do not exist on `SwarmWorkerRunnerInput`.

- [ ] **Step 4: Add metadata to scheduler input type**

In `desktop/app-capabilities/swarm-task/main/scheduler.ts`, update `SwarmWorkerRunnerInput`:

```ts
export type SwarmWorkerRunnerInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly config: SwarmTaskConfig
  readonly abortSignal?: AbortSignal
}
```

- [ ] **Step 5: Compute metadata before running workers**

In `desktop/app-capabilities/swarm-task/main/scheduler.ts`, replace `runRound` and its call site with:

```ts
    const runRound = async (slotIndex: number, sequenceIndex: number): Promise<void> => {
      totals.started++
      const batchIndex = Math.floor((sequenceIndex - 1) / input.config.concurrency) + 1
      const outcome = await runWorker(deps.runner, {
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: slotIndex,
        roundIndex: sequenceIndex,
        sequenceIndex,
        slotIndex,
        batchIndex,
        config: input.config,
        abortSignal: control.abort.signal,
      })
```

Then update `runSlot` to call the new signature:

```ts
    const runSlot = async (slotIndex: number): Promise<void> => {
      while (!control.stopRefill && !control.abort.signal.aborted) {
        if (nextRound > input.config.maxRounds) return
        const sequenceIndex = nextRound
        nextRound++
        await runRound(slotIndex, sequenceIndex)
        if (input.config.runMode === "batch") return
      }
    }
```

- [ ] **Step 6: Run scheduler tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit scheduler work**

Run:

```bash
git add desktop/app-capabilities/swarm-task/main/scheduler.ts desktop/app-capabilities/swarm-task/main/__tests__/scheduler.test.ts
git commit -m "feat: add swarm worker scheduling metadata"
```

---

### Task 3: Prompt Builder Injection Sections

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`
- Test: `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`

**Interfaces:**
- Consumes: `SwarmTaskConfig.promptInjection`
- Consumes: `BuildSwarmWorkerPromptInput.sequenceIndex`, `slotIndex`, `batchIndex`
- Produces: prompt sections `## Swarm Sequence`, `## Recent Summaries`, `## Previous Handoff`, `## File Write Rules`, `## Prompt Appendix`, `## User Prompt`, `## Structured Ending Protocol`
- Produces: `extractSwarmStructuredOutput(text)` unchanged.

- [ ] **Step 1: Replace prompt-builder config fixture**

In `desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts`, replace the `config` fixture with:

```ts
const config: SwarmTaskConfig = {
  projectId: "project-1",
  prompt: "检查当前模块并处理一个真实问题。",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: true },
    previousHandoff: { enabled: true },
    summary: { enabled: true, injectRecent: true, recentLimit: 2 },
    fileWrite: {
      enabled: true,
      path: "reports/swarm.md",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "额外规则：保持改动很小。",
  },
  runMode: "continuous",
  concurrency: 4,
  maxRounds: 8,
  agent: {},
}
```

- [ ] **Step 2: Replace stable order test**

In the same test file, replace the stable order test with:

```ts
it("builds enabled prompt injection sections in a stable order", () => {
  const prompt = buildSwarmWorkerPrompt({
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 3,
    roundIndex: 3,
    sequenceIndex: 3,
    slotIndex: 3,
    batchIndex: 1,
    config,
    recentSummaries,
    previousHandoffs: [
      { workerIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1, handoff: "下一轮继续看 service.ts。" },
    ],
  })

  expect(prompt.indexOf("## Swarm Sequence")).toBeLessThan(prompt.indexOf("## Recent Summaries"))
  expect(prompt.indexOf("## Recent Summaries")).toBeLessThan(prompt.indexOf("## Previous Handoff"))
  expect(prompt.indexOf("## Previous Handoff")).toBeLessThan(prompt.indexOf("## File Write Rules"))
  expect(prompt.indexOf("## File Write Rules")).toBeLessThan(prompt.indexOf("## Prompt Appendix"))
  expect(prompt.indexOf("## Prompt Appendix")).toBeLessThan(prompt.indexOf("## User Prompt"))
  expect(prompt.indexOf("## User Prompt")).toBeLessThan(prompt.indexOf("## Structured Ending Protocol"))
  expect(prompt).toContain("sequenceIndex: 3")
  expect(prompt).toContain("slotIndex: 3")
  expect(prompt).toContain("batchIndex: 1")
  expect(prompt).toContain("concurrency: 4")
  expect(prompt).toContain("reports/swarm.md")
  expect(prompt).toContain("Mode: append-only")
  expect(prompt).toContain("Only append new content to the end of the file.")
  expect(prompt).toContain("reports/swarm.md.lock")
  expect(prompt).toContain("第一轮确认入口文件。")
  expect(prompt).toContain("第二轮补了测试。")
  expect(prompt).toContain("下一轮继续看 service.ts。")
  expect(prompt).toContain("检查当前模块并处理一个真实问题。")
  expect(prompt).toContain("<SYNAPSE_SWARM_SUMMARY>")
  expect(prompt).toContain("<SYNAPSE_SWARM_HANDOFF>")
})
```

- [ ] **Step 3: Add default omission and update-mode tests**

Add these tests below the stable order test:

```ts
it("omits all optional injection sections by default", () => {
  const prompt = buildSwarmWorkerPrompt({
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    sequenceIndex: 1,
    slotIndex: 1,
    batchIndex: 1,
    config: {
      ...config,
      promptInjection: {
        sequenceBatch: { enabled: false },
        previousHandoff: { enabled: false },
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        fileWrite: {
          enabled: false,
          path: "",
          mode: "append-only",
          lock: { enabled: true },
        },
        customAppendix: "",
      },
    },
    recentSummaries,
    previousHandoffs: [
      { workerIndex: 1, sequenceIndex: 1, slotIndex: 1, batchIndex: 1, handoff: "ignored" },
    ],
  })

  expect(prompt).not.toContain("## Swarm Sequence")
  expect(prompt).not.toContain("## Recent Summaries")
  expect(prompt).not.toContain("## Previous Handoff")
  expect(prompt).not.toContain("## File Write Rules")
  expect(prompt).not.toContain("## Prompt Appendix")
  expect(prompt).not.toContain("<SYNAPSE_SWARM_SUMMARY>")
  expect(prompt).not.toContain("<SYNAPSE_SWARM_HANDOFF>")
  expect(prompt).toContain("## User Prompt")
})

it("injects update-mode file write rules without lock when lock is disabled", () => {
  const prompt = buildSwarmWorkerPrompt({
    taskId: "task-1",
    runId: "run-1",
    workerIndex: 1,
    roundIndex: 1,
    sequenceIndex: 1,
    slotIndex: 1,
    batchIndex: 1,
    config: {
      ...config,
      promptInjection: {
        ...config.promptInjection,
        sequenceBatch: { enabled: false },
        previousHandoff: { enabled: false },
        summary: { enabled: false, injectRecent: false, recentLimit: 3 },
        fileWrite: {
          enabled: true,
          path: "reports/swarm.md",
          mode: "update",
          lock: { enabled: false },
        },
        customAppendix: "",
      },
    },
    recentSummaries: [],
    previousHandoffs: [],
  })

  expect(prompt).toContain("Mode: update")
  expect(prompt).toContain("You may insert, modify, reorganize, or delete existing content")
  expect(prompt).not.toContain(".lock")
})
```

- [ ] **Step 4: Run prompt-builder tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts
```

Expected: FAIL because the prompt builder still reads legacy config fields and old input shape.

- [ ] **Step 5: Update prompt-builder input types**

In `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`, replace `BuildSwarmWorkerPromptInput` with:

```ts
export type SwarmPromptHandoff = {
  readonly workerIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly handoff: string
}

export type BuildSwarmWorkerPromptInput = {
  readonly taskId: string
  readonly runId: string
  readonly workerIndex: number
  readonly roundIndex: number
  readonly sequenceIndex: number
  readonly slotIndex: number
  readonly batchIndex: number
  readonly config: SwarmTaskConfig
  readonly recentSummaries: readonly SwarmWorkerRun[]
  readonly previousHandoffs: readonly SwarmPromptHandoff[]
}
```

- [ ] **Step 6: Replace `buildSwarmWorkerPrompt`**

In `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`, replace `buildSwarmWorkerPrompt` with:

```ts
export function buildSwarmWorkerPrompt(input: BuildSwarmWorkerPromptInput): string {
  const sections: string[] = []
  const injection = input.config.promptInjection

  if (injection.sequenceBatch.enabled) {
    sections.push(sequenceBatchSection(input))
  }

  if (injection.summary.enabled && injection.summary.injectRecent) {
    const summaries = input.recentSummaries
      .filter((item) => item.summary?.trim())
      .slice(-injection.summary.recentLimit)
    if (summaries.length > 0) {
      sections.push([
        "## Recent Summaries",
        ...summaries.map((item) => {
          const sequenceIndex = item.sequenceIndex ?? item.roundIndex
          const slotIndex = item.slotIndex ?? item.workerIndex
          return `- sequence ${sequenceIndex}, slot ${slotIndex}: ${item.summary?.trim()}`
        }),
      ].join("\n"))
    }
  }

  if (injection.previousHandoff.enabled && input.previousHandoffs.length > 0) {
    sections.push(previousHandoffSection(input.previousHandoffs))
  }

  const fileWrite = fileWriteSection(input.config)
  if (fileWrite) sections.push(fileWrite)

  const custom = injection.customAppendix.trim()
  if (custom) {
    sections.push(["## Prompt Appendix", custom].join("\n"))
  }

  sections.push([
    "## User Prompt",
    input.config.prompt,
  ].join("\n"))

  const ending = structuredEndingSection(input.config)
  if (ending) sections.push(ending)

  return sections.filter(Boolean).join("\n\n")
}
```

- [ ] **Step 7: Replace section helpers**

In `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`, delete `runtimeContextSection`, `summaryFileSection`, and `parallelContextSection`. Add these helpers before `structuredEndingSection`:

```ts
function sequenceBatchSection(input: BuildSwarmWorkerPromptInput): string {
  return [
    "## Swarm Sequence",
    `taskId: ${input.taskId}`,
    `runId: ${input.runId}`,
    `runMode: ${input.config.runMode}`,
    `concurrency: ${input.config.concurrency}`,
    `maxRounds: ${input.config.maxRounds}`,
    `sequenceIndex: ${input.sequenceIndex}`,
    `sequenceIndexZeroBased: ${input.sequenceIndex - 1}`,
    `slotIndex: ${input.slotIndex}`,
    `slotIndexZeroBased: ${input.slotIndex - 1}`,
    `batchIndex: ${input.batchIndex}`,
    `batchIndexZeroBased: ${input.batchIndex - 1}`,
  ].join("\n")
}

function previousHandoffSection(handoffs: readonly SwarmPromptHandoff[]): string {
  return [
    "## Previous Handoff",
    ...handoffs.map((item) => [
      `### sequence ${item.sequenceIndex}, slot ${item.slotIndex}, batch ${item.batchIndex}`,
      item.handoff.trim(),
    ].join("\n")),
  ].join("\n")
}

function fileWriteSection(config: SwarmTaskConfig): string {
  const fileWrite = config.promptInjection.fileWrite
  const path = fileWrite.path.trim()
  if (!fileWrite.enabled || !path) return ""

  const lines = [
    "## File Write Rules",
    `Write file: ${path}`,
    `Mode: ${fileWrite.mode}`,
    "",
  ]

  if (fileWrite.mode === "append-only") {
    lines.push(
      "Before writing, read the current file content. Do not overwrite, rewrite, delete, or modify existing content. Only append new content to the end of the file.",
    )
  } else {
    lines.push(
      "You may insert, modify, reorganize, or delete existing content when the task requires it. Preserve unrelated user content.",
    )
  }

  if (fileWrite.lock.enabled) {
    lines.push(
      "",
      `Before changing the file, acquire an atomic project-local lock directory named ${path}.lock. Release the lock after the write finishes. If the lock cannot be acquired, wait and retry instead of writing concurrently.`,
    )
  }

  return lines.join("\n")
}
```

- [ ] **Step 8: Update structured ending helper**

In `desktop/app-capabilities/swarm-task/main/prompt-builder.ts`, replace `structuredEndingSection` with:

```ts
function structuredEndingSection(config: SwarmTaskConfig): string {
  const lines = ["## Structured Ending Protocol"]
  if (config.promptInjection.summary.enabled) {
    lines.push(
      "End with a concise Summary block:",
      SWARM_SUMMARY_OPEN,
      "本轮完成的工作、产出、风险和建议。",
      SWARM_SUMMARY_CLOSE,
    )
  }
  if (config.promptInjection.previousHandoff.enabled) {
    lines.push(
      "End with a Handoff block for the next worker round:",
      SWARM_HANDOFF_OPEN,
      "给下一轮 worker 的接续信息。",
      SWARM_HANDOFF_CLOSE,
    )
  }
  return lines.length > 1 ? lines.join("\n") : ""
}
```

- [ ] **Step 9: Run prompt-builder tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts
```

Expected: PASS.

- [ ] **Step 10: Commit prompt-builder work**

Run:

```bash
git add desktop/app-capabilities/swarm-task/main/prompt-builder.ts desktop/app-capabilities/swarm-task/main/__tests__/prompt-builder.test.ts
git commit -m "feat: gate swarm prompt injection sections"
```

---

### Task 4: Service Handoff And Worker Persistence

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/service.ts`
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`
- Test: `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`

**Interfaces:**
- Consumes: scheduler metadata from `SwarmWorkerRunnerInput`
- Consumes: `buildSwarmWorkerPrompt({ previousHandoffs })`
- Produces: persisted `SwarmWorkerRun.sequenceIndex`, `slotIndex`, `batchIndex`
- Produces: previous-batch handoff selection through local helper `previousBatchHandoffs(workers, batchIndex)`
- Preserves: Agent Runtime `userMeta.swarmRoundIndex` and `swarmWorkerIndex`, and adds `swarmSequenceIndex`, `swarmSlotIndex`, `swarmBatchIndex`.

- [ ] **Step 1: Update service test fixture**

In `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`, replace the `config` fixture with:

```ts
const config = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only" as const,
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  agent: {},
}
```

- [ ] **Step 2: Update Agent gateway metadata test**

In the `creates an Agent Runtime swarm gateway with swarm session metadata` test, add these fields to the worker input:

```ts
      sequenceIndex: 3,
      slotIndex: 2,
      batchIndex: 2,
```

Update the expected `userMeta` to:

```ts
          userMeta: {
            swarmTaskId: "task-1",
            swarmRunId: "run-1",
            swarmWorkerRunId: "worker-1",
            swarmRoundIndex: 3,
            swarmWorkerIndex: 2,
            swarmSequenceIndex: 3,
            swarmSlotIndex: 2,
            swarmBatchIndex: 2,
          },
```

- [ ] **Step 3: Add previous-batch handoff service test**

Add this test after `starts in the background and stores worker summaries`:

```ts
it("injects previous batch handoffs instead of the last arbitrary handoff", async () => {
  const workers = namespace<SwarmWorkerRun>()
  const prompts: string[] = []
  const { service } = serviceHarness({
    workers,
    agent: {
      sendWorker: vi.fn(async (input) => {
        prompts.push(input.prompt)
        return {
          conversationId: `conversation-${prompts.length}`,
          resultText: [
            "<SYNAPSE_SWARM_SUMMARY>",
            `summary ${prompts.length}`,
            "</SYNAPSE_SWARM_SUMMARY>",
            "<SYNAPSE_SWARM_HANDOFF>",
            `handoff ${prompts.length}`,
            "</SYNAPSE_SWARM_HANDOFF>",
          ].join("\n"),
          status: "success",
          events: [],
        }
      }),
    },
  })
  const task = await service.createTask({
    name: "任务",
    config: {
      ...config,
      promptInjection: {
        ...config.promptInjection,
        previousHandoff: { enabled: true },
        summary: { enabled: true, injectRecent: false, recentLimit: 3 },
      },
      runMode: "continuous",
      concurrency: 2,
      maxRounds: 3,
    },
  })

  const run = await service.startRun({ taskId: task.id })

  await vi.waitFor(async () => {
    expect(await service.getRun(run.id)).toMatchObject({ status: "success" })
  })

  expect(prompts[0]).not.toContain("## Previous Handoff")
  expect(prompts[1]).not.toContain("## Previous Handoff")
  expect(prompts[2]).toContain("## Previous Handoff")
  expect(prompts[2]).toContain("handoff 1")
  expect(prompts[2]).toContain("handoff 2")
})
```

- [ ] **Step 4: Run service tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
```

Expected: FAIL because service still references legacy config fields and old prompt input.

- [ ] **Step 5: Update Agent Runtime user metadata**

In `desktop/app-capabilities/swarm-task/main/service.ts`, update `createAgentRuntimeSwarmGateway().sendWorker()` `userMeta`:

```ts
          userMeta: {
            swarmTaskId: input.task.id,
            swarmRunId: input.run.id,
            swarmWorkerRunId: input.worker.id,
            swarmRoundIndex: input.worker.roundIndex,
            swarmWorkerIndex: input.worker.workerIndex,
            swarmSequenceIndex: input.worker.sequenceIndex ?? input.worker.roundIndex,
            swarmSlotIndex: input.worker.slotIndex ?? input.worker.workerIndex,
            swarmBatchIndex: input.worker.batchIndex,
          },
```

- [ ] **Step 6: Persist scheduler metadata on workers**

In `createWorkerRunner()` in `desktop/app-capabilities/swarm-task/main/service.ts`, replace previous handoff selection and worker creation with:

```ts
      const previousWorkers = await listWorkerRuns(run.id)
      const previousHandoffs = input.config.promptInjection.previousHandoff.enabled
        ? previousBatchHandoffs(previousWorkers, input.batchIndex)
        : []

      const worker: SwarmWorkerRun = {
        id: createId(),
        schemaVersion: 1,
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        batchIndex: input.batchIndex,
        status: "running",
        sessionKey: `swarm:${input.taskId}:${input.runId}`,
        startedAt: timestamp(),
        lastPhase: "queued",
      }
```

Update the prompt builder call:

```ts
      const prompt = buildSwarmWorkerPrompt({
        taskId: input.taskId,
        runId: input.runId,
        workerIndex: input.workerIndex,
        roundIndex: input.roundIndex,
        sequenceIndex: input.sequenceIndex,
        slotIndex: input.slotIndex,
        batchIndex: input.batchIndex,
        config: input.config,
        recentSummaries: previousWorkers,
        previousHandoffs,
      })
```

- [ ] **Step 7: Add previous batch helper**

In `desktop/app-capabilities/swarm-task/main/service.ts`, add this helper near `isAbortError`:

```ts
function previousBatchHandoffs(
  workers: readonly SwarmWorkerRun[],
  currentBatchIndex: number,
): Array<{
  workerIndex: number
  sequenceIndex: number
  slotIndex: number
  batchIndex: number
  handoff: string
}> {
  const previousBatchIndex = currentBatchIndex - 1
  if (previousBatchIndex < 1) return []

  return workers
    .filter((worker) => (worker.batchIndex ?? inferBatchIndex(worker)) === previousBatchIndex)
    .filter((worker) => worker.handoff?.trim())
    .sort((left, right) =>
      (left.sequenceIndex ?? left.roundIndex) - (right.sequenceIndex ?? right.roundIndex)
      || (left.workerIndex - right.workerIndex))
    .map((worker) => ({
      workerIndex: worker.workerIndex,
      sequenceIndex: worker.sequenceIndex ?? worker.roundIndex,
      slotIndex: worker.slotIndex ?? worker.workerIndex,
      batchIndex: worker.batchIndex ?? inferBatchIndex(worker),
      handoff: worker.handoff?.trim() ?? "",
    }))
}

function inferBatchIndex(worker: SwarmWorkerRun): number {
  return worker.batchIndex ?? 1
}
```

- [ ] **Step 8: Update summary and handoff persistence**

In `persistWorkerOutcome()` in `desktop/app-capabilities/swarm-task/main/service.ts`, replace summary and handoff references with:

```ts
    const extracted = extractSwarmStructuredOutput(outcome.resultText)
    const summaryEnabled = input.input.config.promptInjection.summary.enabled
    const handoffEnabled = input.input.config.promptInjection.previousHandoff.enabled
    const summary = summaryEnabled
      ? extracted.summary ?? fallbackSummary(outcome.resultText)
      : undefined
    const summaryFallback = summaryEnabled && !extracted.summary
```

And replace the handoff spread with:

```ts
      ...(handoffEnabled && extracted.handoff ? { handoff: extracted.handoff } : {}),
```

- [ ] **Step 9: Update config override merging**

In `mergeConfigSnapshot()` in `desktop/app-capabilities/swarm-task/main/service.ts`, replace the returned object with:

```ts
  return swarmTaskConfigSchema.parse({
    ...normalizedBase,
    ...override,
    promptInjection: {
      ...normalizedBase.promptInjection,
      ...override.promptInjection,
      sequenceBatch: {
        ...normalizedBase.promptInjection.sequenceBatch,
        ...override.promptInjection?.sequenceBatch,
      },
      previousHandoff: {
        ...normalizedBase.promptInjection.previousHandoff,
        ...override.promptInjection?.previousHandoff,
      },
      summary: {
        ...normalizedBase.promptInjection.summary,
        ...override.promptInjection?.summary,
      },
      fileWrite: {
        ...normalizedBase.promptInjection.fileWrite,
        ...override.promptInjection?.fileWrite,
        lock: {
          ...normalizedBase.promptInjection.fileWrite.lock,
          ...override.promptInjection?.fileWrite?.lock,
        },
      },
    },
    agent: {
      ...normalizedBase.agent,
      ...override.agent,
    },
  })
```

- [ ] **Step 10: Update nested override test**

In `desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts`, replace assertions in `merges nested partial config overrides into a full snapshot` with:

```ts
    const task = await service.createTask({
      name: "任务",
      config: {
        ...config,
        promptInjection: {
          ...config.promptInjection,
          sequenceBatch: { enabled: true },
          summary: {
            enabled: false,
            injectRecent: false,
            recentLimit: 7,
          },
          customAppendix: "keep me",
        },
      },
    })

    const run = await service.startRun({
      taskId: task.id,
      configOverride: {
        promptInjection: {
          summary: { injectRecent: true },
          previousHandoff: { enabled: true },
          sequenceBatch: { enabled: false },
        },
      },
    })

    expect(run.configSnapshot.promptInjection.summary).toMatchObject({
      enabled: false,
      injectRecent: true,
      recentLimit: 7,
    })
    expect(run.configSnapshot.promptInjection.previousHandoff).toMatchObject({ enabled: true })
    expect(run.configSnapshot.promptInjection.sequenceBatch).toMatchObject({ enabled: false })
    expect(run.configSnapshot.promptInjection.customAppendix).toBe("keep me")
```

- [ ] **Step 11: Run service tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
```

Expected: PASS.

- [ ] **Step 12: Commit service work**

Run:

```bash
git add desktop/app-capabilities/swarm-task/main/service.ts desktop/app-capabilities/swarm-task/main/__tests__/service.test.ts
git commit -m "feat: use swarm prompt injection in worker service"
```

---

### Task 5: Renderer Defaults And Config Form

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/renderer/index.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`
- Modify: `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`
- Test: `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`

**Interfaces:**
- Consumes: `SwarmTaskConfig.promptInjection`
- Produces: new task defaults with all injection switches off.
- Produces: UI groups `任务`, `运行`, `注入`, `文件`
- Produces: file controls shown only when `promptInjection.fileWrite.enabled` is true.

- [ ] **Step 1: Update renderer test fixtures**

In `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`, replace every fixture `currentConfig` block with this shape:

```ts
currentConfig: {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 2,
  maxRounds: 2,
  agent: {},
},
```

For task B, keep `projectId: "project-2"` and `prompt: "Run B."`.

- [ ] **Step 2: Update create-task default expectation**

In the test that expects `swarmTaskBridge.createTask` to be called, replace the expected config with:

```ts
      config: {
        projectId: "project-1",
        prompt: "填写任务目标",
        presetId: "general",
        promptInjection: {
          sequenceBatch: { enabled: false },
          previousHandoff: { enabled: false },
          summary: { enabled: false, injectRecent: false, recentLimit: 3 },
          fileWrite: {
            enabled: false,
            path: "",
            mode: "append-only",
            lock: { enabled: true },
          },
          customAppendix: "",
        },
        runMode: "batch",
        concurrency: 1,
        maxRounds: 1,
        agent: {},
      },
```

- [ ] **Step 3: Add config form behavior tests**

In `desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx`, add this test near existing config form tests:

```ts
it("saves prompt injection and file write controls", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SwarmTaskModule />)
  })

  await clickButton("配置")
  await clickSwitch("序列和批次")
  await clickSwitch("上一轮交接")
  await clickSwitch("记录摘要")
  await clickSwitch("文件写入")
  await setInputValue(await waitForInput("文件路径"), "reports/swarm.md")
  await selectByLabel("写入方式", "允许更新")
  await clickButton("保存")

  expect(swarmTaskBridge.updateTask).toHaveBeenCalledWith({
    taskId: "task-1",
    patch: {
      currentConfig: expect.objectContaining({
        promptInjection: {
          sequenceBatch: { enabled: true },
          previousHandoff: { enabled: true },
          summary: { enabled: true, injectRecent: false, recentLimit: 3 },
          fileWrite: {
            enabled: true,
            path: "reports/swarm.md",
            mode: "update",
            lock: { enabled: true },
          },
          customAppendix: "",
        },
      }),
    },
  })
})

it("hides file controls until file writing is enabled", async () => {
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<SwarmTaskModule />)
  })

  await clickButton("配置")

  expect(screenQueryLabel("文件路径")).toBeNull()
  await clickSwitch("文件写入")
  expect(await waitForInput("文件路径")).toBeTruthy()
})
```

If helper functions do not exist, add these near existing test helpers:

```ts
async function clickSwitch(label: string) {
  const input = await waitForInput(label)
  await act(async () => {
    input.click()
  })
}

function screenQueryLabel(label: string): HTMLElement | null {
  return document.querySelector(`[aria-label="${label}"], label[for]`)
}

async function selectByLabel(label: string, optionText: string) {
  const trigger = await waitForButton(label)
  await act(async () => {
    trigger.click()
  })
  const option = await waitForText(optionText)
  await act(async () => {
    option.click()
  })
}
```

- [ ] **Step 4: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx
```

Expected: FAIL because renderer defaults and form controls still use legacy fields.

- [ ] **Step 5: Update default task config**

In `desktop/app-capabilities/swarm-task/renderer/index.tsx`, replace `baseTaskConfig` with:

```ts
const baseTaskConfig: Omit<SwarmTaskConfig, "projectId"> = {
  prompt: "填写任务目标",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only",
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch",
  concurrency: 1,
  maxRounds: 1,
  agent: {},
}
```

- [ ] **Step 6: Replace context section in config form**

In `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`, replace the `上下文` section with:

```tsx
      <ConfigSection title="注入">
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <SwitchField
            label="序列和批次"
            checked={value.promptInjection.sequenceBatch.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                sequenceBatch: { enabled: checked },
              },
            })}
          />
          <SwitchField
            label="上一轮交接"
            checked={value.promptInjection.previousHandoff.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                previousHandoff: { enabled: checked },
              },
            })}
          />
          <SwitchField
            label="记录摘要"
            checked={value.promptInjection.summary.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                summary: {
                  ...value.promptInjection.summary,
                  enabled: checked,
                  injectRecent: checked ? value.promptInjection.summary.injectRecent : false,
                },
              },
            })}
          />
          <SwitchField
            label="最近摘要"
            checked={value.promptInjection.summary.injectRecent}
            disabled={!value.promptInjection.summary.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                summary: { ...value.promptInjection.summary, injectRecent: checked },
              },
            })}
          />
        </div>
      </ConfigSection>
```

Update `SwitchField` props to accept `disabled?: boolean` and pass it to `Switch`:

```tsx
function SwitchField({
  label,
  checked,
  disabled = false,
  onCheckedChange,
}: {
  readonly label: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="grid min-h-10 min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 data-[disabled=true]:opacity-60" data-disabled={disabled}>
      <span className="min-w-0 truncate text-sm font-medium leading-snug">{label}</span>
      <div className="flex h-10 items-center justify-center">
        <Switch disabled={disabled} checked={checked} onCheckedChange={onCheckedChange} aria-label={label} />
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Replace summary file section with file section**

In `desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx`, replace the `汇总文件` section with:

```tsx
      <ConfigSection title="文件">
        <div className="grid min-w-0 gap-3">
          <SwitchField
            label="文件写入"
            checked={value.promptInjection.fileWrite.enabled}
            onCheckedChange={(checked) => onChange({
              ...value,
              promptInjection: {
                ...value.promptInjection,
                fileWrite: {
                  ...value.promptInjection.fileWrite,
                  enabled: checked,
                },
              },
            })}
          />
          {value.promptInjection.fileWrite.enabled ? (
            <>
              <Field className="grid gap-2">
                <FieldLabel htmlFor="swarm-task-file-write-path">文件路径</FieldLabel>
                <FieldContent>
                  <Input
                    id="swarm-task-file-write-path"
                    aria-label="文件路径"
                    value={value.promptInjection.fileWrite.path}
                    onChange={(event) => onChange({
                      ...value,
                      promptInjection: {
                        ...value.promptInjection,
                        fileWrite: {
                          ...value.promptInjection.fileWrite,
                          path: event.target.value,
                        },
                      },
                    })}
                  />
                  <p className="text-xs text-muted-foreground">相对项目路径</p>
                </FieldContent>
              </Field>
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                <Field className="grid gap-2">
                  <FieldLabel>写入方式</FieldLabel>
                  <FieldContent>
                    <Select
                      value={value.promptInjection.fileWrite.mode}
                      onValueChange={(mode) => onChange({
                        ...value,
                        promptInjection: {
                          ...value.promptInjection,
                          fileWrite: {
                            ...value.promptInjection.fileWrite,
                            mode: mode as SwarmTaskConfig["promptInjection"]["fileWrite"]["mode"],
                          },
                        },
                      })}
                    >
                      <SelectTrigger className="w-full" aria-label="写入方式">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="append-only">只追加</SelectItem>
                        <SelectItem value="update">允许更新</SelectItem>
                      </SelectContent>
                    </Select>
                  </FieldContent>
                </Field>
                <SwitchField
                  label="文件锁"
                  checked={value.promptInjection.fileWrite.lock.enabled}
                  onCheckedChange={(checked) => onChange({
                    ...value,
                    promptInjection: {
                      ...value.promptInjection,
                      fileWrite: {
                        ...value.promptInjection.fileWrite,
                        lock: { enabled: checked },
                      },
                    },
                  })}
                />
              </div>
            </>
          ) : null}
        </div>
      </ConfigSection>
```

- [ ] **Step 8: Run renderer tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit renderer work**

Run:

```bash
git add desktop/app-capabilities/swarm-task/renderer/index.tsx desktop/app-capabilities/swarm-task/renderer/components/swarm-task-config-form.tsx desktop/app-capabilities/swarm-task/renderer/__tests__/swarm-task-app.test.tsx
git commit -m "feat: add swarm prompt injection controls"
```

---

### Task 6: MCP, Workflow Fixtures, Docs, And Release Note

**Files:**
- Modify: `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`
- Modify: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`
- Modify: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`
- Modify: `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
- Modify: `RELEASE_NOTES_PENDING.md`
- Test: `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`
- Test: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts`
- Test: `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`

**Interfaces:**
- Consumes: new `SwarmTaskConfig.promptInjection` schema.
- Preserves: Swarm Task MCP action names and Workflow node override surface.
- Produces: updated built-in `synapse-skill` API reference for MCP callers.

- [ ] **Step 1: Update dispatcher fixtures**

In `desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts`, replace `baseConfig` with:

```ts
const baseConfig = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only" as const,
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  agent: {},
}
```

Update the legacy absence assertion to:

```ts
    expect(JSON.stringify(task)).not.toContain("workspacePath")
    expect(JSON.stringify(task)).not.toContain("gitContext")
    expect(JSON.stringify(task)).not.toContain("targetFilePolicy")
    expect(JSON.stringify(task)).not.toContain("injectOptions")
    expect(JSON.stringify(task)).not.toContain("summaryFile")
```

- [ ] **Step 2: Update workflow test fixtures**

In `desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts` and `desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts`, replace any `configSnapshot` or task config fixture with this config shape:

```ts
const baseConfig = {
  projectId: "project-1",
  prompt: "Run.",
  presetId: "general",
  promptInjection: {
    sequenceBatch: { enabled: false },
    previousHandoff: { enabled: false },
    summary: { enabled: false, injectRecent: false, recentLimit: 3 },
    fileWrite: {
      enabled: false,
      path: "",
      mode: "append-only" as const,
      lock: { enabled: true },
    },
    customAppendix: "",
  },
  runMode: "batch" as const,
  concurrency: 2,
  maxRounds: 2,
  agent: {},
}
```

Keep existing workflow override tests limited to:

```ts
{
  promptOverride: "Run {{input}}.",
  runModeOverride: "continuous",
  maxRoundsOverride: 10,
  concurrencyOverride: 2,
}
```

Expected run override in executor tests:

```ts
expect(service.startRun).toHaveBeenCalledWith({
  taskId: "task-1",
  configOverride: {
    prompt: "Run value.",
    runMode: "continuous",
    maxRounds: 10,
    concurrency: 2,
  },
})
```

- [ ] **Step 3: Run MCP and workflow tests and verify pass**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts
```

Expected: PASS.

- [ ] **Step 4: Update MCP API reference**

In `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`, replace the Swarm Task create config example with:

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
    "promptInjection": {
      "sequenceBatch": { "enabled": false },
      "previousHandoff": { "enabled": false },
      "summary": {
        "enabled": false,
        "injectRecent": false,
        "recentLimit": 3
      },
      "fileWrite": {
        "enabled": false,
        "path": "",
        "mode": "append-only",
        "lock": { "enabled": true }
      },
      "customAppendix": ""
    },
    "agent": {}
  }
}
```

Replace the paragraph after the example with:

```md
Returns the saved task. `runMode` is `batch` or `continuous`. `concurrency` is 1-20. `maxRounds` is 1-500. Workers run in the selected project path. `promptInjection` controls optional prompt context only; Synapse does not merge files or guarantee worker file writes.
```

- [ ] **Step 5: Update release note**

Append this bullet to `RELEASE_NOTES_PENDING.md`:

```md
- 调整蜂群任务：新任务默认只并发执行用户提示词，序列批次、上一轮交接、摘要和文件写入规则都改为显式开关，并新增只追加/允许更新的文件写入提示策略。
```

- [ ] **Step 6: Commit docs and integration fixtures**

Run:

```bash
git add desktop/app-capabilities/swarm-task/main/__tests__/dispatcher.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/schema.test.ts desktop/app-capabilities/swarm-task/workflow-node/__tests__/executor.test.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "docs: update swarm prompt injection surfaces"
```

---

### Task 7: Full Verification

**Files:**
- Inspect: `desktop/app-capabilities/swarm-task`
- Inspect: `desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts`
- Inspect: `desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md`
- Inspect: `RELEASE_NOTES_PENDING.md`
- Test: all Swarm Task tests.

**Interfaces:**
- Consumes: all prior task outputs.
- Produces: verified implementation ready for review.

- [ ] **Step 1: Run all Swarm Task and schema tests**

Run:

```bash
pnpm --filter @synapse/desktop run test -- desktop/app-capabilities/swarm-task desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts
```

Expected: PASS.

- [ ] **Step 2: Search for removed user-facing fields**

Run:

```bash
rg -n "injectOptions|summaryFile|workerIdentity|roundContext|runContext|parallelContext|targetFilePolicy|Git 上下文|汇总文件" desktop/app-capabilities/swarm-task desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md
```

Expected: no matches for user-facing legacy config. Acceptable matches only inside legacy normalization tests or migration code in `shared/schema.ts`.

- [ ] **Step 3: Search for disallowed UI copy and styles**

Run:

```bash
rg -n "此页面用于|该功能可以帮助|作为您的智能助手|style=\\{|#[0-9a-fA-F]{3,8}|bg-\\[|text-\\[" desktop/app-capabilities/swarm-task
```

Expected: no matches.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git diff --stat HEAD~6..HEAD
git diff -- desktop/app-capabilities/swarm-task desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
```

Expected: changes are scoped to Swarm Task schema, scheduler, prompt builder, service, renderer, tests, MCP docs, and release notes.

- [ ] **Step 5: Commit verification fixes if needed**

If Step 1, Step 2, Step 3, or Step 4 reveals a small fix, make the fix and run the failing command again. Then commit with:

```bash
git add desktop/app-capabilities/swarm-task desktop/electron/runtime/data-repo/__tests__/swarm-task-schema.test.ts desktop/resources/templates/skills/synapse-skill/files/automation/api-reference.md RELEASE_NOTES_PENDING.md
git commit -m "fix: finalize swarm prompt injection controls"
```

If no fix is needed, do not create an empty commit.
