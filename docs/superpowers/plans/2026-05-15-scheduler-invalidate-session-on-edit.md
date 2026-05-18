# Scheduler: Invalidate Agent Session on Task Edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When a scheduled task is edited, force the next Agent execution to start a fresh conversation instead of resuming the previous one, even if sessionPolicy is "resume".

**Architecture:** Add a `configVersion` counter to `ScheduledTaskEntry`. Increment it on user-initiated updates (but not on system bookkeeping like `markRunResult`/`markScheduled`/`setEnabled`). Pass it through `ActionRuntimeContext` to the executor. The agent executor compares `context.configVersion` against the `configVersion` stored in `previousOutputs` — on mismatch, it discards `lastConversationId` and forces a fresh session. Each successful run writes the current `configVersion` into its outputs for the next comparison.

**Tech Stack:** TypeScript, Vitest

**Brainstorm doc:** `plan/2026-05-15-scheduler-agent-invalidate-session-on-edit.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `desktop/electron/services/task-scheduler/types.ts` | Modify | Add `configVersion` to `ScheduledTaskEntryV2` |
| `desktop/electron/services/task-scheduler/task-repository.ts` | Modify | Increment on `update()`, isolate `setEnabled()` |
| `desktop/electron/action-runtime/action-registry.ts` | Modify | Add `configVersion` to `ActionRuntimeContext` |
| `desktop/electron/services/task-scheduler/execution-service.ts` | Modify | Pass `task.configVersion` into context |
| `desktop/action-packages/builtin/agent/executor.main.ts` | Modify | Compare versions, write to outputs |
| `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts` | Modify | Test configVersion behavior |
| `desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts` | Modify | Test configVersion passthrough |
| `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts` | Modify | Test version comparison logic |

---

### Task 1: Add `configVersion` to `ScheduledTaskEntryV2`

**Files:**
- Modify: `desktop/electron/services/task-scheduler/types.ts:35-54`

- [ ] **Step 1: Add the field to the type**

In `ScheduledTaskEntryV2`, add `configVersion` after `runCount`:

```typescript
  readonly runCount: number
  readonly configVersion: number
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`

Expected: Type errors in `task-repository.ts` where `create()` and `update()` build the object without `configVersion`. This is expected — Task 2 fixes them.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/task-scheduler/types.ts
git commit -m "feat(scheduler): add configVersion field to ScheduledTaskEntryV2"
```

---

### Task 2: Increment `configVersion` in `TaskRepository`

**Files:**
- Modify: `desktop/electron/services/task-scheduler/task-repository.ts:31-108`
- Test: `desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts`

- [ ] **Step 1: Write the failing test — update increments configVersion**

Add to the existing `describe("ScheduledTaskRepository")` block in `task-repository.test.ts`:

```typescript
  it("increments configVersion on update", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Agent digest",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: "builtin.agent", config: { prompt: "summarize" } },
    })

    expect(task.configVersion).toBe(0)

    const updated1 = await repo.update(task.id, { name: "Renamed" })
    expect(updated1.configVersion).toBe(1)

    const updated2 = await repo.update(task.id, {
      action: { type: "builtin.agent", config: { prompt: "changed" } },
    })
    expect(updated2.configVersion).toBe(2)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `configVersion` is not set.

- [ ] **Step 3: Write the failing test — setEnabled does NOT increment configVersion**

Add to the same describe block:

```typescript
  it("does not increment configVersion when toggling enabled", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Agent digest",
      scope: { type: "global" },
      trigger: { type: "builtin.interval", config: { everyMinutes: 5 } },
      action: { type: "builtin.agent", config: { prompt: "summarize" } },
    })

    expect(task.configVersion).toBe(0)

    const disabled = await repo.setEnabled(task.id, false)
    expect(disabled.configVersion).toBe(0)
    expect(disabled.enabled).toBe(false)

    const enabled = await repo.setEnabled(task.id, true)
    expect(enabled.configVersion).toBe(0)
    expect(enabled.enabled).toBe(true)
  })
```

- [ ] **Step 4: Write the failing test — create sets configVersion to 0**

Add to the same describe block:

```typescript
  it("creates tasks with configVersion 0", async () => {
    const repo = new ScheduledTaskRepository({
      tasks: new MemoryNamespace<ScheduledTaskEntry>("task-scheduler.tasks"),
      now: () => new Date("2026-04-29T00:00:00.000Z"),
      idFactory: () => "task:1",
    })
    const task = await repo.create({
      name: "Build",
      scope: { type: "global" },
      trigger: { type: "builtin.cron", config: { expr: "0 2 * * *" } },
      action: { type: "builtin.command", config: { command: "echo hi" } },
    })

    expect(task.configVersion).toBe(0)
  })
```

- [ ] **Step 5: Implement — update `create()` in task-repository.ts**

In `create()`, add `configVersion: 0` to the task object (after `runCount: 0`):

```typescript
      runCount: 0,
      configVersion: 0,
```

- [ ] **Step 6: Implement — update `update()` in task-repository.ts**

In `update()`, add `configVersion` increment to the `candidate` object. After the `action:` line:

```typescript
      configVersion: (existing.configVersion ?? 0) + 1,
```

The `?? 0` handles legacy tasks that don't have the field yet.

- [ ] **Step 7: Implement — isolate `setEnabled()` from `update()`**

Replace the current `setEnabled` method that delegates to `update()`:

```typescript
  async setEnabled(id: string, enabled: boolean): Promise<ScheduledTaskEntry> {
    const existing = await this.require(id)
    const trigger = normalizeTrigger(existing.trigger)
    const next: ScheduledTaskEntry = {
      ...existing,
      enabled,
      updatedAt: this.isoNow(),
      nextRunAt: enabled
        ? computeNextRunAt({ trigger, from: this.now(), createdAt: existing.createdAt }).toISOString()
        : undefined,
    }
    await this.tasks.upsert(next)
    return next
  }
```

This preserves the existing `configVersion` without incrementing it.

- [ ] **Step 8: Run all repository tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts --reporter=verbose 2>&1 | tail -20`

Expected: All PASS.

- [ ] **Step 9: Commit**

```bash
git add desktop/electron/services/task-scheduler/task-repository.ts desktop/electron/services/task-scheduler/__tests__/task-repository.test.ts
git commit -m "feat(scheduler): increment configVersion on update, not on setEnabled"
```

---

### Task 3: Add `configVersion` to `ActionRuntimeContext`

**Files:**
- Modify: `desktop/electron/action-runtime/action-registry.ts:11-18`

- [ ] **Step 1: Add the optional field**

Add `configVersion` to `ActionRuntimeContext`:

```typescript
export type ActionRuntimeContext = {
  readonly taskId: string
  readonly runId: string
  readonly triggeredBy: "schedule" | "manual" | "missed_run"
  readonly cwd: string
  readonly actor: ActorIdentity
  readonly abortSignal: AbortSignal
  readonly configVersion?: number
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -20`

Expected: No errors (field is optional, existing callers are fine).

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/action-runtime/action-registry.ts
git commit -m "feat(action-runtime): add optional configVersion to ActionRuntimeContext"
```

---

### Task 4: Pass `configVersion` from `ExecutionService`

**Files:**
- Modify: `desktop/electron/services/task-scheduler/execution-service.ts:49-56`
- Test: `desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("TaskSchedulerExecutionService")` block in `execution-service.test.ts`:

```typescript
  it("passes task configVersion through action context", async () => {
    let observedContext: { configVersion?: number } | undefined
    const spyAction: MainActionDefinition<TestActionConfig> = {
      ...testAction,
      execute: async ({ context }) => {
        observedContext = context
        return { status: "success", summary: "ok" }
      },
    }
    const harness = await createExecutionHarness({ action: spyAction })

    await harness.service.runTask(harness.task, "manual")

    expect(observedContext?.configVersion).toBe(0)
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts -t "passes task configVersion" --reporter=verbose 2>&1 | tail -20`

Expected: FAIL — `observedContext.configVersion` is `undefined`.

- [ ] **Step 3: Implement — add configVersion to context in execution-service.ts**

In `runTask()`, add `configVersion` to the `context` object (after `abortSignal`):

```typescript
      const context = {
        taskId: task.id,
        runId: run.id,
        triggeredBy,
        cwd: resolveCwd(task, this.deps.defaultCwd),
        actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" } as const,
        abortSignal: controller.signal,
        configVersion: task.configVersion ?? 0,
      }
```

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts -t "passes task configVersion" --reporter=verbose 2>&1 | tail -20`

Expected: PASS.

- [ ] **Step 5: Run all execution-service tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/task-scheduler/execution-service.ts desktop/electron/services/task-scheduler/__tests__/execution-service.test.ts
git commit -m "feat(scheduler): pass configVersion through action execution context"
```

---

### Task 5: Agent executor — compare configVersion and write to outputs

**Files:**
- Modify: `desktop/action-packages/builtin/agent/executor.main.ts:27-64`
- Test: `desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts`

- [ ] **Step 1: Write the failing test — config changed forces fresh session**

Add to the existing `describe("builtin agent action executor")` block:

```typescript
  it("forces fresh session when configVersion changed since last run", async () => {
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "new-conversation",
        status: "success" as const,
        summary: "done",
        durationMs: 100,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })

    const result = await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        providerId: "anthropic",
        modelTier: "sonnet",
        mode: "default",
        prompt: "Run work",
        sessionPolicy: "resume",
        timeoutMins: 30,
      },
      context: {
        taskId: "task-1",
        runId: "run-2",
        triggeredBy: "schedule",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: new AbortController().signal,
        configVersion: 3,
      },
      previousOutputs: {
        conversationId: "old-conversation",
        configVersion: 1,
      },
    })

    expect(runtime.sendScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionPolicy: "resume",
        lastConversationId: undefined,
      }),
    )
    expect(result.outputs).toEqual({
      conversationId: "new-conversation",
      configVersion: 3,
    })
  })
```

- [ ] **Step 2: Write the failing test — matching configVersion allows resume**

```typescript
  it("allows resume when configVersion matches last run", async () => {
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "old-conversation",
        status: "success" as const,
        summary: "done",
        durationMs: 50,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })

    await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        providerId: "anthropic",
        modelTier: "sonnet",
        mode: "default",
        prompt: "Run work",
        sessionPolicy: "resume",
        timeoutMins: 30,
      },
      context: {
        taskId: "task-1",
        runId: "run-2",
        triggeredBy: "schedule",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: new AbortController().signal,
        configVersion: 2,
      },
      previousOutputs: {
        conversationId: "old-conversation",
        configVersion: 2,
      },
    })

    expect(runtime.sendScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        lastConversationId: "old-conversation",
      }),
    )
  })
```

- [ ] **Step 3: Write the failing test — legacy runs without configVersion are not invalidated**

```typescript
  it("does not force fresh when previous run has no configVersion (legacy)", async () => {
    const runtime = {
      sendScheduled: vi.fn(async () => ({
        conversationId: "old-conversation",
        status: "success" as const,
        summary: "done",
        durationMs: 50,
      })),
    } as unknown as AgentRuntimeService
    const action = createAgentAction({
      getAgentRuntime: async () => runtime,
    })

    await action.execute({
      config: {
        projectId: "project-1",
        agentType: "claude-code",
        providerId: "anthropic",
        modelTier: "sonnet",
        mode: "default",
        prompt: "Run work",
        sessionPolicy: "resume",
        timeoutMins: 30,
      },
      context: {
        taskId: "task-1",
        runId: "run-2",
        triggeredBy: "schedule",
        cwd: "/repo",
        actor: { kind: "user", id: "task-scheduler" },
        abortSignal: new AbortController().signal,
        configVersion: 0,
      },
      previousOutputs: {
        conversationId: "old-conversation",
      },
    })

    expect(runtime.sendScheduled).toHaveBeenCalledWith(
      expect.objectContaining({
        lastConversationId: "old-conversation",
      }),
    )
  })
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: The 3 new tests FAIL (outputs don't have `configVersion`, version comparison not implemented).

- [ ] **Step 5: Implement the version comparison in executor.main.ts**

Replace the `execute` function body in `createAgentAction()` with:

```typescript
    async execute(input) {
      const runtime = await deps.getAgentRuntime(input.config.projectId)
      if (!runtime) {
        return {
          status: "failed",
          error: `No agent runtime found for project "${input.config.projectId}"`,
          metrics: { durationMs: 0 },
        }
      }

      const lastConversationId = typeof input.previousOutputs?.conversationId === "string"
        ? input.previousOutputs.conversationId
        : undefined

      const currentConfigVersion = input.context.configVersion ?? 0
      const previousConfigVersion = typeof input.previousOutputs?.configVersion === "number"
        ? input.previousOutputs.configVersion
        : undefined
      const configChanged = previousConfigVersion !== undefined
        && previousConfigVersion !== currentConfigVersion

      const result = await runtime.sendScheduled({
        projectId: input.config.projectId,
        agentType: input.config.agentType,
        mode: input.config.mode,
        prompt: input.config.prompt,
        sessionPolicy: input.config.sessionPolicy,
        timeoutMs: scheduledTimeoutMs(input.config.timeoutMins),
        lastConversationId: configChanged ? undefined : lastConversationId,
        abortSignal: input.context.abortSignal,
        providerId: input.config.providerId,
        modelTier: input.config.modelTier,
      })
      const status = result.status === "error"
        ? input.context.abortSignal.aborted ? "cancelled" : "failed"
        : result.status

      return {
        status,
        summary: result.summary,
        error: persistableAgentError(status, result.error),
        outputs: { conversationId: result.conversationId, configVersion: currentConfigVersion },
        metrics: { durationMs: result.durationMs },
      }
    },
```

- [ ] **Step 6: Run all agent executor tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts --reporter=verbose 2>&1 | tail -30`

Expected: All PASS (including old tests — they don't set `configVersion` in context so it defaults to `0`, and don't set it in previousOutputs so `previousConfigVersion` is `undefined`, meaning `configChanged` is `false`).

- [ ] **Step 7: Commit**

```bash
git add desktop/action-packages/builtin/agent/executor.main.ts desktop/action-packages/builtin/agent/__tests__/executor.main.test.ts
git commit -m "feat(agent-action): invalidate resume session when task configVersion changed"
```

---

### Task 6: Fix test fixtures and full regression

**Files:**
- Modify: `desktop/electron/services/task-scheduler/__tests__/external-api.test.ts:13-28`
- Modify: `desktop/electron/services/task-scheduler/__tests__/task-scheduler-service.test.ts:225-241`

- [ ] **Step 1: Add `configVersion: 0` to `baseTask` in external-api.test.ts**

In `external-api.test.ts`, add `configVersion: 0` after `runCount: 0` in the `baseTask` literal:

```typescript
  runCount: 0,
  configVersion: 0,
```

- [ ] **Step 2: Add `configVersion: 0` to `createTask()` in task-scheduler-service.test.ts**

In `task-scheduler-service.test.ts`, add `configVersion: 0` after `runCount: 0` in the `createTask()` helper:

```typescript
    runCount: 0,
    configVersion: 0,
```

- [ ] **Step 3: Run task-scheduler tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/task-scheduler/__tests__/ --reporter=verbose 2>&1 | tail -40`

Expected: All PASS.

- [ ] **Step 4: Run agent runtime tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/ --reporter=verbose 2>&1 | tail -40`

Expected: All PASS (no changes to agent-runtime, but sanity check).

- [ ] **Step 5: Run agent action tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/action-packages/builtin/agent/__tests__/ --reporter=verbose 2>&1 | tail -30`

Expected: All PASS.

- [ ] **Step 6: Run type check**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | tail -20`

Expected: No type errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test(scheduler): fix test fixtures for configVersion field"
```
