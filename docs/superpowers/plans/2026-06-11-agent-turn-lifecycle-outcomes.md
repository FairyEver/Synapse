# Agent Turn Lifecycle Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a turn lifecycle outcome layer so user-initiated Agent stops are stored and displayed as cancellation outcomes instead of generic SDK execution failures.

**Architecture:** Introduce a pure `turn-outcome` module that owns lifecycle state, cancellation intent, diagnostics, terminal outcome locking, and SDK-event normalization. Wire the existing `ConversationRouter`, `SessionManager`, and `ClaudeSDKSession` paths through that module, then project structured outcomes into existing Agent events, timeline items, history, transcript export, and phase rows.

**Tech Stack:** Electron main process, React renderer, TypeScript, Vitest, shadcn/Radix UI primitives.

---

## File Structure

- Create `desktop/electron/services/agent-runtime/turn-outcome.ts`
  - Owns `AgentTurnOutcome`, `AgentTurnDiagnostic`, `TurnLifecycle`, lifecycle transition helpers, and `normalizeExecutorEvent`.
- Create `desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts`
  - Unit tests for lifecycle transitions and outcome normalization.
- Modify `desktop/electron/services/agent-runtime/types.ts`
  - Expose structured turn outcome metadata on result and error events.
- Modify `desktop/electron/services/agent-runtime/session-lifecycle.ts`
  - Store the active turn lifecycle in `RuntimeSessionState` and `QueuedTurn`.
- Modify `desktop/electron/services/agent-runtime/session-manager.ts`
  - Record graceful and force cancel intent before interrupt/close operations.
- Modify `desktop/electron/services/agent-runtime/conversation-router.ts`
  - Create lifecycle records per turn, normalize SDK errors/results, lock terminal outcomes, and emit product-level events.
- Modify `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
  - Preserve query failure diagnostics without deciding product semantics.
- Modify `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`
  - Cover graceful/force cancellation followed by SDK abort.
- Modify `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`
  - Ensure raw query errors still surface as executor diagnostics.
- Modify `desktop/src/types/agent.ts`
  - Add renderer-side structured turn outcome types.
- Modify `desktop/src/lib/agent-timeline.ts`
  - Carry turn outcome metadata into timeline result/error items.
- Modify `desktop/src/modules/agent/components/agent-timeline-item.tsx`
  - Render cancellation outcome with non-destructive treatment.
- Modify `desktop/src/lib/agent-transcript.ts`
  - Export product outcome copy instead of raw SDK abort text when structured outcome exists.
- Modify `desktop/src/lib/__tests__/agent-timeline.test.ts`, `desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx`, and `desktop/src/lib/__tests__/agent-transcript.test.ts`
  - Add renderer-side projection and export coverage.
- Modify `RELEASE_NOTES_PENDING.md`
  - Add one user-facing note after implementation.

---

### Task 1: Add The Pure Turn Outcome Model

**Files:**
- Create: `desktop/electron/services/agent-runtime/turn-outcome.ts`
- Create: `desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts`
- Modify: `desktop/electron/services/agent-runtime/types.ts`

- [ ] **Step 1: Write failing unit tests for lifecycle normalization**

Create `desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import {
  createTurnLifecycle,
  markCancelRequested,
  markTimeoutRequested,
  normalizeExecutorEvent,
  outcomeMessage,
} from "../turn-outcome"

describe("turn outcome normalization", () => {
  it("maps SDK abort during graceful cancellation to cancelled", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    markCancelRequested(lifecycle, {
      mode: "graceful",
      source: "user",
      now: () => "2026-06-11T00:00:01.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "aborted",
        message: "Request was aborted",
      },
    })

    expect(outcome).toMatchObject({
      status: "cancelled",
      mode: "graceful",
      reason: "user_cancelled",
      message: "已停止本次执行。",
    })
    expect(lifecycle.terminalOutcome).toBe(outcome)
    expect(lifecycle.diagnostics).toHaveLength(1)
  })

  it("maps SDK abort during force cancellation to force-cancelled copy", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    markCancelRequested(lifecycle, {
      mode: "force",
      source: "user",
      now: () => "2026-06-11T00:00:01.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.closed",
      diagnostic: {
        source: "claude-sdk",
        kind: "closed",
        message: "closed after force kill",
      },
    })

    expect(outcome).toMatchObject({
      status: "cancelled",
      mode: "force",
      reason: "force_cancelled",
      message: "已强制停止本次执行。",
    })
  })

  it("keeps SDK abort without cancel intent as failed", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "aborted",
        message: "Request was aborted",
      },
    })

    expect(outcome).toMatchObject({
      status: "failed",
      reason: "provider_aborted",
      message: "请求中断，任务未完成。",
    })
  })

  it("maps timeout intent plus abort to timed_out", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    markTimeoutRequested(lifecycle, {
      source: "relay",
      now: () => "2026-06-11T00:01:00.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "aborted",
        message: "Request was aborted",
      },
    })

    expect(outcome).toMatchObject({
      status: "timed_out",
      reason: "relay_timeout",
      message: "执行超时，任务尚未完成。",
    })
  })

  it("does not overwrite a terminal outcome with a late SDK error", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    const completed = normalizeExecutorEvent(lifecycle, {
      type: "executor.result",
    })

    const late = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "error",
        message: "late error",
      },
    })

    expect(completed).toEqual({ status: "completed" })
    expect(late).toBe(completed)
    expect(lifecycle.diagnostics).toEqual([{
      source: "claude-sdk",
      kind: "error",
      message: "late error",
    }])
  })

  it("keeps tool-use interrupted diagnostics recoverable", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "tool_use_interrupted",
        message: "[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use",
      },
    })

    expect(outcome).toMatchObject({
      status: "interrupted",
      reason: "tool_use_interrupted",
      recoverable: true,
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
    })
    expect(outcomeMessage(outcome)).toBe("Agent 在工具调用后中断，发送“继续”可接着执行。")
  })
})
```

- [ ] **Step 2: Run the new tests and verify they fail because the module does not exist**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts
```

Expected: FAIL with a module resolution error for `../turn-outcome`.

- [ ] **Step 3: Add the pure implementation**

Create `desktop/electron/services/agent-runtime/turn-outcome.ts`:

```ts
export type AgentTurnOutcomeStatus =
  | "completed"
  | "cancelled"
  | "failed"
  | "timed_out"
  | "interrupted"

export type AgentTurnDiagnosticKind =
  | "aborted"
  | "closed"
  | "error"
  | "tool_use_interrupted"

export interface AgentTurnDiagnostic {
  readonly source: "claude-sdk" | "agent-runtime" | "process-runner"
  readonly kind: AgentTurnDiagnosticKind
  readonly message?: string
}

export type AgentTurnFailureReason =
  | "provider_aborted"
  | "network_interrupted"
  | "permission_denied"
  | "permission_timeout"
  | "sdk_crashed"
  | "runtime_error"
  | "unknown"

export type AgentTurnOutcome =
  | { readonly status: "completed"; readonly message?: string }
  | {
      readonly status: "cancelled"
      readonly mode: "graceful" | "force"
      readonly reason: "user_cancelled" | "system_cancelled" | "force_cancelled"
      readonly message: string
      readonly diagnostics?: readonly AgentTurnDiagnostic[]
    }
  | {
      readonly status: "failed"
      readonly reason: AgentTurnFailureReason
      readonly message: string
      readonly diagnostics?: readonly AgentTurnDiagnostic[]
    }
  | {
      readonly status: "timed_out"
      readonly reason: "runtime_timeout" | "relay_timeout" | "scheduler_timeout"
      readonly message: string
      readonly diagnostics?: readonly AgentTurnDiagnostic[]
    }
  | {
      readonly status: "interrupted"
      readonly reason: "tool_use_interrupted"
      readonly recoverable: true
      readonly message: string
      readonly diagnostics?: readonly AgentTurnDiagnostic[]
    }

export interface TurnLifecycle {
  readonly turnId: string
  readonly conversationId: string
  state: "queued" | "starting" | "running" | "cancelling" | "force_cancelling" | "timing_out" | "terminal"
  cancelIntent?: {
    readonly mode: "graceful" | "force"
    readonly source: "user" | "system"
    readonly requestedAt: string
  }
  timeoutIntent?: {
    readonly source: "runtime" | "scheduler" | "relay"
    readonly requestedAt: string
  }
  terminalOutcome?: AgentTurnOutcome
  diagnostics: AgentTurnDiagnostic[]
}

export type ExecutorEvent =
  | { readonly type: "executor.result" }
  | { readonly type: "executor.error"; readonly diagnostic: AgentTurnDiagnostic }
  | { readonly type: "executor.aborted"; readonly diagnostic?: AgentTurnDiagnostic }
  | { readonly type: "executor.closed"; readonly diagnostic?: AgentTurnDiagnostic }

export function createTurnLifecycle(input: {
  readonly turnId: string
  readonly conversationId: string
  readonly now?: () => string
}): TurnLifecycle {
  return {
    turnId: input.turnId,
    conversationId: input.conversationId,
    state: "running",
    diagnostics: [],
  }
}

export function markCancelRequested(
  lifecycle: TurnLifecycle,
  input: {
    readonly mode: "graceful" | "force"
    readonly source: "user" | "system"
    readonly now: () => string
  },
): void {
  if (lifecycle.terminalOutcome) return
  lifecycle.cancelIntent = {
    mode: input.mode,
    source: input.source,
    requestedAt: input.now(),
  }
  lifecycle.state = input.mode === "force" ? "force_cancelling" : "cancelling"
}

export function markTimeoutRequested(
  lifecycle: TurnLifecycle,
  input: {
    readonly source: "runtime" | "scheduler" | "relay"
    readonly now: () => string
  },
): void {
  if (lifecycle.terminalOutcome) return
  lifecycle.timeoutIntent = {
    source: input.source,
    requestedAt: input.now(),
  }
  lifecycle.state = "timing_out"
}

export function normalizeExecutorEvent(
  lifecycle: TurnLifecycle,
  event: ExecutorEvent,
): AgentTurnOutcome | undefined {
  const diagnostic = "diagnostic" in event ? event.diagnostic : undefined
  if (diagnostic) lifecycle.diagnostics.push(diagnostic)

  if (lifecycle.terminalOutcome) {
    return lifecycle.terminalOutcome
  }

  const outcome = outcomeForEvent(lifecycle, event)
  if (!outcome) return undefined
  const withDiagnostics = attachDiagnostics(outcome, lifecycle.diagnostics)
  lifecycle.terminalOutcome = withDiagnostics
  lifecycle.state = "terminal"
  return withDiagnostics
}

export function outcomeMessage(outcome: AgentTurnOutcome): string {
  if (outcome.status === "completed") return outcome.message ?? ""
  return outcome.message
}

function outcomeForEvent(
  lifecycle: TurnLifecycle,
  event: ExecutorEvent,
): AgentTurnOutcome | undefined {
  if (event.type === "executor.result") return { status: "completed" }

  if (event.type === "executor.error" || event.type === "executor.aborted" || event.type === "executor.closed") {
    if (lifecycle.cancelIntent) {
      const mode = lifecycle.cancelIntent.mode
      return {
        status: "cancelled",
        mode,
        reason: mode === "force"
          ? "force_cancelled"
          : lifecycle.cancelIntent.source === "user" ? "user_cancelled" : "system_cancelled",
        message: mode === "force" ? "已强制停止本次执行。" : "已停止本次执行。",
      }
    }
    if (lifecycle.timeoutIntent) {
      return {
        status: "timed_out",
        reason: `${lifecycle.timeoutIntent.source}_timeout`,
        message: "执行超时，任务尚未完成。",
      } as AgentTurnOutcome
    }
    if (isToolUseInterrupted(event.diagnostic)) {
      return {
        status: "interrupted",
        reason: "tool_use_interrupted",
        recoverable: true,
        message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
      }
    }
    return {
      status: "failed",
      reason: failureReason(event.diagnostic),
      message: failedMessage(event.diagnostic),
    }
  }

  return undefined
}

function attachDiagnostics(outcome: AgentTurnOutcome, diagnostics: readonly AgentTurnDiagnostic[]): AgentTurnOutcome {
  if (outcome.status === "completed" || diagnostics.length === 0) return outcome
  return { ...outcome, diagnostics: [...diagnostics] } as AgentTurnOutcome
}

function isToolUseInterrupted(diagnostic: AgentTurnDiagnostic | undefined): boolean {
  return diagnostic?.kind === "tool_use_interrupted"
    || (/\bstop_reason=tool_use\b/.test(diagnostic?.message ?? "")
      && /\bresult_type=user\b/.test(diagnostic?.message ?? ""))
}

function failureReason(diagnostic: AgentTurnDiagnostic | undefined): AgentTurnFailureReason {
  if (diagnostic?.kind === "aborted") return "provider_aborted"
  return "runtime_error"
}

function failedMessage(diagnostic: AgentTurnDiagnostic | undefined): string {
  if (diagnostic?.kind === "aborted") return "请求中断，任务未完成。"
  return diagnostic?.message ? `Agent 执行失败。诊断信息：${diagnostic.message}` : "Agent 执行失败。"
}
```

- [ ] **Step 4: Extend main-process event types**

Modify `desktop/electron/services/agent-runtime/types.ts`:

```ts
import type { AgentTurnOutcome } from "./turn-outcome"
```

Add to `AgentResultMetadata`:

```ts
  readonly turnOutcome?: AgentTurnOutcome
```

Add to `AgentErrorEvent`:

```ts
  readonly turnOutcome?: AgentTurnOutcome
```

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts desktop/electron/services/agent-runtime/__tests__/agent-error-messages.test.ts
```

Expected: PASS.

Commit:

```bash
git add desktop/electron/services/agent-runtime/turn-outcome.ts desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts
git commit -m "feat(agent): add turn outcome lifecycle model"
```

---

### Task 2: Store Lifecycle On Active Turns And Record Cancel Intent

**Files:**
- Modify: `desktop/electron/services/agent-runtime/session-lifecycle.ts`
- Modify: `desktop/electron/services/agent-runtime/session-manager.ts`
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`

- [ ] **Step 1: Write failing tests for lifecycle cancel intent**

Add to `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`:

```ts
import type { RuntimeSessionState } from "../session-lifecycle"

function runtimeState(service: AgentRuntimeService, conversationIdValue: string): RuntimeSessionState {
  const states = (service as unknown as { readonly states: Map<string, RuntimeSessionState> }).states
  const state = states.get(conversationIdValue)
  if (!state) throw new Error(`Missing runtime state for ${conversationIdValue}`)
  return state
}

it("records graceful cancel intent on the active lifecycle before interrupting", async () => {
  const session = new CancellableLiveSession({ graceful: true })
  const factory = new CancellableSessionFactory(session)
  const service = createService(factory)

  const sendPromise = service.send(baseMessage("hello"))
  await waitForBusy(service, "hello")

  const convId = conversationId("local", "s1", "active")
  const state = runtimeState(service, convId)
  expect(state.activeLifecycle?.cancelIntent).toBeUndefined()

  await service.cancelTurn(convId)

  expect(state.activeLifecycle?.cancelIntent).toMatchObject({
    mode: "graceful",
    source: "user",
  })
  expect(state.activeLifecycle?.state).toBe("cancelling")

  session.emitResult("stopped")
  await sendPromise
})

it("upgrades lifecycle cancel intent when force killing", async () => {
  const session = new CancellableLiveSession({ graceful: true })
  const factory = new CancellableSessionFactory(session)
  const service = createService(factory)

  const sendPromise = service.send(baseMessage("hello"))
  await waitForBusy(service, "hello")

  const convId = conversationId("local", "s1", "active")
  await service.cancelTurn(convId)
  await service.forceKillTurn(convId)

  const state = runtimeState(service, convId)
  expect(state.activeLifecycle?.cancelIntent).toMatchObject({
    mode: "force",
    source: "user",
  })

  await sendPromise
})
```

- [ ] **Step 2: Run tests and verify they fail because `activeLifecycle` does not exist**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts
```

Expected: FAIL with TypeScript errors or assertions around `activeLifecycle`.

- [ ] **Step 3: Add lifecycle fields to runtime state and queued turns**

Modify `desktop/electron/services/agent-runtime/session-lifecycle.ts`:

```ts
import type { TurnLifecycle } from "./turn-outcome"
```

Add to `RuntimeSessionState`:

```ts
  activeLifecycle?: TurnLifecycle
```

Add to `QueuedTurn`:

```ts
  readonly lifecycle: TurnLifecycle
```

- [ ] **Step 4: Create lifecycle records when enqueueing turns**

Modify `desktop/electron/services/agent-runtime/conversation-router.ts` imports:

```ts
import { createTurnLifecycle } from "./turn-outcome"
```

Inside `enqueueTurn`, after `turnId` is created, add:

```ts
    const lifecycle = createTurnLifecycle({
      turnId,
      conversationId: conversation.id,
      now: () => this.isoNow(),
    })
```

Include it in the queued turn:

```ts
        lifecycle,
```

Inside `processQueue`, before calling `processTurn`, set:

```ts
          state.activeLifecycle = turn.lifecycle
```

Inside `finally` for each turn, clear only if the active lifecycle belongs to this turn:

```ts
          if (state.activeLifecycle?.turnId === turn.turnId) {
            state.activeLifecycle = undefined
          }
```

- [ ] **Step 5: Record cancel intent in service methods**

Modify `desktop/electron/services/agent-runtime/agent-runtime-service.ts` imports:

```ts
import { markCancelRequested } from "./turn-outcome"
```

In `cancelTurn`, immediately after `state.cancelState = { requestedAt: Date.now() }`, add:

```ts
    if (state.activeLifecycle) {
      markCancelRequested(state.activeLifecycle, {
        mode: "graceful",
        source: "user",
        now: () => this.isoNow(),
      })
    }
```

In the branch where graceful cancel is not supported and the runtime hard-kills, upgrade the lifecycle before abort/close:

```ts
        if (state.activeLifecycle) {
          markCancelRequested(state.activeLifecycle, {
            mode: "force",
            source: "user",
            now: () => this.isoNow(),
          })
        }
```

In `forceKillTurn`, before `state.turnAbortController?.abort("force-kill")`, add:

```ts
    if (state.activeLifecycle) {
      markCancelRequested(state.activeLifecycle, {
        mode: "force",
        source: "user",
        now: () => this.isoNow(),
      })
    }
```

- [ ] **Step 6: Run cancel tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts desktop/electron/services/agent-runtime/__tests__/session-manager.test.ts
```

Expected: PASS.

Commit:

```bash
git add desktop/electron/services/agent-runtime/session-lifecycle.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/agent-runtime-service.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts
git commit -m "feat(agent): track cancel intent on turn lifecycle"
```

---

### Task 3: Normalize Runtime SDK Errors Through Lifecycle Outcomes

**Files:**
- Modify: `desktop/electron/services/agent-runtime/conversation-router.ts`
- Modify: `desktop/electron/services/agent-runtime/claude-sdk-session.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`
- Test: `desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts`

- [ ] **Step 1: Write failing runtime tests for SDK abort after cancel**

Add a test session helper to `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`:

```ts
class AbortAfterCancelSession extends CancellableLiveSession {
  async cancelCurrentTurn(): Promise<boolean> {
    this.cancelCalled = true
    this.emitError("Agent 执行失败。诊断信息：Request was aborted", {
      turnOutcome: undefined,
    })
    return true
  }
}
```

If the existing helper does not expose `emitError`, add this method to `CancellableLiveSession`:

```ts
emitError(message: string, extra: Partial<Extract<AgentEvent, { type: "error" }>> = {}): void {
  this.events.push({
    type: "error",
    message,
    conversationId: "conversation-a",
    providerId: "anthropic",
    timestamp: "2026-05-10T00:00:00.000Z",
    ...extra,
  })
  this.resolveNext()
}
```

Add the test:

```ts
it("normalizes SDK abort error after graceful cancel to cancelled result", async () => {
  const session = new AbortAfterCancelSession({ graceful: true })
  const factory = new CancellableSessionFactory(session)
  const service = createService(factory)

  const turn = service.send(baseMessage("hello"))
  await waitForBusy(service, "hello")

  await service.cancelTurn(conversationId("local", "s1", "active"))

  const result = await turn
  expect(result.error).toBe("已停止本次执行。")
  expect(result.events).toContainEqual(expect.objectContaining({
    type: "result",
    metadata: expect.objectContaining({
      cancelled: true,
      turnOutcome: expect.objectContaining({
        status: "cancelled",
        mode: "graceful",
        reason: "user_cancelled",
      }),
    }),
  }))
  expect(JSON.stringify(result.events)).not.toContain("Agent 执行失败")
})
```

- [ ] **Step 2: Run the focused test and verify it fails with the current red error**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts -t "normalizes SDK abort error after graceful cancel"
```

Expected: FAIL because the result still contains the generic execution failure.

- [ ] **Step 3: Add event-to-outcome projection helpers**

Modify `desktop/electron/services/agent-runtime/turn-outcome.ts`:

```ts
import type { AgentErrorEvent, AgentEvent, AgentResultEvent } from "./types"
```

Add:

```ts
export function diagnosticFromAgentError(event: AgentErrorEvent): AgentTurnDiagnostic {
  const message = event.message
  return {
    source: "claude-sdk",
    kind: /\bstop_reason=tool_use\b/.test(message) && /\bresult_type=user\b/.test(message)
      ? "tool_use_interrupted"
      : /Request was aborted/i.test(message) ? "aborted" : "error",
    message,
  }
}

export function outcomeToAgentEvent(input: {
  readonly outcome: AgentTurnOutcome
  readonly conversationId: string
  readonly providerId?: string
  readonly sdkSessionId?: string
  readonly timestamp: string
}): AgentEvent {
  const base = {
    conversationId: input.conversationId,
    providerId: input.providerId,
    sdkSessionId: input.sdkSessionId,
    timestamp: input.timestamp,
  }
  if (input.outcome.status === "cancelled") {
    return {
      ...base,
      type: "result",
      content: "",
      done: true,
      metadata: {
        cancelled: true,
        turnOutcome: input.outcome,
      },
    } satisfies AgentResultEvent
  }
  if (input.outcome.status === "interrupted") {
    return {
      ...base,
      type: "error",
      message: input.outcome.message,
      errorKind: "tool_use_interrupted",
      recoverable: true,
      turnOutcome: input.outcome,
    } satisfies AgentErrorEvent
  }
  return {
    ...base,
    type: "error",
    message: outcomeMessage(input.outcome),
    errorKind: "execution_failed",
    recoverable: false,
    turnOutcome: input.outcome,
  } satisfies AgentErrorEvent
}
```

- [ ] **Step 4: Use lifecycle normalization when live-session error events arrive**

Modify `desktop/electron/services/agent-runtime/conversation-router.ts` imports:

```ts
import {
  diagnosticFromAgentError,
  markTimeoutRequested,
  normalizeExecutorEvent,
  outcomeMessage,
  outcomeToAgentEvent,
} from "./turn-outcome"
```

In `processTurn`, replace the `if (event.type === "error")` block's assignment of `error = event.message` with lifecycle-aware logic:

```ts
        if (event.type === "error") {
          const sdkResultUsage = sdkResultUsageFromError(event)
          if (sdkResultUsage) {
            resultUsage = sdkResultUsage
            resultCostUsd = event.costUsd
            resultCostCny = this.estimateLocalCostCny(state, sdkResultUsage)?.total
            resultCostCurrency = resultCostCny === undefined ? undefined : "CNY"
            await this.repository.recordSdkResultUsage({
              conversationId: conversation.id,
              turnId,
              sdkResultUuid: event.sdkResultUuid,
              sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
              usage: sdkResultUsage,
              modelUsage: event.modelUsage,
              userMeta: message.userMeta ?? conversation.userMeta,
            })
          }
          const lifecycle = state.activeLifecycle
          if (lifecycle) {
            const outcome = normalizeExecutorEvent(lifecycle, {
              type: "executor.error",
              diagnostic: diagnosticFromAgentError(event),
            })
            if (outcome) {
              const projected = outcomeToAgentEvent({
                outcome,
                conversationId: conversation.id,
                providerId: message.providerId ?? conversation.providerId,
                sdkSessionId: event.sdkSessionId ?? liveSession.currentSessionId(),
                timestamp: this.isoNow(),
              })
              events[events.length - 1] = projected
              await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
              await this.saveEventSdkSession(conversation.id, projected, liveSession)
              await this.saveEventHistory(conversation.id, projected)
              error = outcome.status === "completed" ? undefined : outcomeMessage(outcome)
              break
            }
          }
          error = event.message
          break
        }
```

- [ ] **Step 5: Normalize explicit abort-signal termination**

In the `if (abortSignal.aborted && !error)` branch of `processTurn`, call `markTimeoutRequested` when the abort reason is a timeout and use `normalizeExecutorEvent` before constructing the returned event:

```ts
      if (abortSignal.aborted && !error) {
        const lifecycle = state.activeLifecycle
        if (lifecycle) {
          const reason = String(abortSignal.reason ?? "")
          if (reason.includes("timeout")) {
            markTimeoutRequested(lifecycle, {
              source: "relay",
              now: () => this.isoNow(),
            })
          }
          const outcome = normalizeExecutorEvent(lifecycle, {
            type: "executor.aborted",
            diagnostic: {
              source: "agent-runtime",
              kind: "aborted",
              message: reason || "abort signal",
            },
          })
          if (outcome) {
            const projected = outcomeToAgentEvent({
              outcome,
              conversationId: conversation.id,
              providerId: message.providerId ?? conversation.providerId,
              sdkSessionId: liveSession.currentSessionId(),
              timestamp: this.isoNow(),
            })
            events.push(projected)
            this.emitEvent(message, conversation.id, projected)
            await this.persistAgentEvent(conversation.id, turnId, events.length, projected)
            await this.saveEventSdkSession(conversation.id, projected, liveSession)
            await this.saveEventHistory(conversation.id, projected)
            await this.sessionManager.closeCurrentTurn(conversation.id)
            return {
              conversationId: conversation.id,
              events,
              resultText: partialText,
              partialText,
              agentSessionId: liveSession.currentSessionId(),
              threadId: liveSession.currentSessionId(),
              error: outcome.status === "completed" ? undefined : outcomeMessage(outcome),
              timedOut: outcome.status === "timed_out",
            }
          }
        }
```

Keep the existing fallback below this block for legacy paths.

- [ ] **Step 6: Run runtime tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts
```

Expected: PASS.

Commit:

```bash
git add desktop/electron/services/agent-runtime/turn-outcome.ts desktop/electron/services/agent-runtime/conversation-router.ts desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts
git commit -m "feat(agent): normalize stopped turns as cancellation"
```

---

### Task 4: Carry Outcomes Through Renderer Timeline And UI

**Files:**
- Modify: `desktop/src/types/agent.ts`
- Modify: `desktop/src/lib/agent-timeline.ts`
- Modify: `desktop/src/modules/agent/components/agent-timeline-item.tsx`
- Test: `desktop/src/lib/__tests__/agent-timeline.test.ts`
- Test: `desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx`

- [ ] **Step 1: Write failing renderer projection tests**

Add to `desktop/src/lib/__tests__/agent-timeline.test.ts`:

```ts
it("preserves turn outcome metadata on cancelled result events", () => {
  const item = agentEventToTimelineItem({
    type: "result",
    content: "",
    done: true,
    metadata: {
      cancelled: true,
      turnOutcome: {
        status: "cancelled",
        mode: "graceful",
        reason: "user_cancelled",
        message: "已停止本次执行。",
        diagnostics: [{
          source: "claude-sdk",
          kind: "aborted",
          message: "Request was aborted",
        }],
      },
    },
  }, {
    id: "item-1",
    timestamp: "2026-06-11T00:00:00.000Z",
  })

  expect(item).toMatchObject({
    kind: "result",
    metadata: {
      cancelled: true,
      turnOutcome: {
        status: "cancelled",
        message: "已停止本次执行。",
      },
    },
  })
})
```

Add to `desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx`:

```tsx
it("renders cancelled outcomes as non-destructive information", () => {
  render(
    <AgentTimelineItem
      item={{
        id: "result-1",
        kind: "result",
        content: "",
        timestamp: "2026-06-11T00:00:00.000Z",
        metadata: {
          cancelled: true,
          turnOutcome: {
            status: "cancelled",
            mode: "graceful",
            reason: "user_cancelled",
            message: "已停止本次执行。",
          },
        },
      }}
      profile={{ label: "Agent" }}
      pendingPermissions={[]}
      onOpenReference={() => undefined}
      onRespondPermission={() => undefined}
    />,
  )

  expect(screen.getByText("已停止本次执行。")).toBeInTheDocument()
  expect(screen.queryByText(/Agent 执行失败/)).not.toBeInTheDocument()
})
```

- [ ] **Step 2: Run renderer tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/agent-timeline.test.ts desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx
```

Expected: FAIL because renderer types and result rendering do not yet handle `turnOutcome`.

- [ ] **Step 3: Add renderer-side turn outcome types**

Modify `desktop/src/types/agent.ts`:

```ts
export interface SynapseAgentTurnDiagnostic {
  readonly source: "claude-sdk" | "agent-runtime" | "process-runner"
  readonly kind: "aborted" | "closed" | "error" | "tool_use_interrupted"
  readonly message?: string
}

export type SynapseAgentTurnOutcome =
  | { readonly status: "completed"; readonly message?: string }
  | {
      readonly status: "cancelled"
      readonly mode: "graceful" | "force"
      readonly reason: "user_cancelled" | "system_cancelled" | "force_cancelled"
      readonly message: string
      readonly diagnostics?: readonly SynapseAgentTurnDiagnostic[]
    }
  | {
      readonly status: "failed"
      readonly reason: string
      readonly message: string
      readonly diagnostics?: readonly SynapseAgentTurnDiagnostic[]
    }
  | {
      readonly status: "timed_out"
      readonly reason: string
      readonly message: string
      readonly diagnostics?: readonly SynapseAgentTurnDiagnostic[]
    }
  | {
      readonly status: "interrupted"
      readonly reason: "tool_use_interrupted"
      readonly recoverable: true
      readonly message: string
      readonly diagnostics?: readonly SynapseAgentTurnDiagnostic[]
    }
```

Add `turnOutcome?: SynapseAgentTurnOutcome` to `SynapseAgentResultMetadata`, result event metadata, `SynapseAgentErrorTimelineItem`, and error event type.

- [ ] **Step 4: Parse and preserve outcome metadata**

Modify `desktop/src/lib/agent-timeline.ts`:

Add to result event mapping:

```ts
        metadata: resultMetadata(event),
```

The existing call stays, but `resultMetadata` and `storedResultMetadata` must include:

```ts
    turnOutcome: turnOutcomeMetadata(metadata, "turnOutcome"),
```

Add helper:

```ts
function turnOutcomeMetadata(metadata: Record<string, unknown> | undefined, key: string) {
  const value = metadata?.[key]
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  const status = typeof record.status === "string" ? record.status : undefined
  const message = typeof record.message === "string" ? record.message : undefined
  if (!status) return undefined
  return {
    ...record,
    status,
    ...(message ? { message } : {}),
  } as SynapseAgentResultMetadata["turnOutcome"]
}
```

In the `"error"` branch, preserve:

```ts
        turnOutcome: event.turnOutcome,
```

- [ ] **Step 5: Render cancelled result outcome as a neutral alert**

Modify `desktop/src/modules/agent/components/agent-timeline-item.tsx` result branch:

```tsx
    case "result": {
      const outcome = item.metadata?.turnOutcome
      if (outcome?.status === "cancelled") {
        return (
          <Alert>
            <Info data-icon="inline-start" />
            <AlertDescription>{outcome.message}</AlertDescription>
          </Alert>
        )
      }
      return null
    }
```

Keep recoverable errors as non-destructive and real failed errors as destructive.

- [ ] **Step 6: Run renderer tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/agent-timeline.test.ts desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx
```

Expected: PASS.

Commit:

```bash
git add desktop/src/types/agent.ts desktop/src/lib/agent-timeline.ts desktop/src/modules/agent/components/agent-timeline-item.tsx desktop/src/lib/__tests__/agent-timeline.test.ts desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx
git commit -m "feat(agent): render cancelled turn outcomes neutrally"
```

---

### Task 5: Align Transcript Export, History Replay, And Phase Terminal Behavior

**Files:**
- Modify: `desktop/src/lib/agent-transcript.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-events.ts`
- Modify: `desktop/src/modules/agent/utils/phase-reducer.ts`
- Test: `desktop/src/lib/__tests__/agent-transcript.test.ts`
- Test: `desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`

- [ ] **Step 1: Write failing transcript and phase tests**

Add to `desktop/src/lib/__tests__/agent-transcript.test.ts`:

```ts
it("exports cancelled turn outcome copy instead of raw SDK abort diagnostics", () => {
  const text = formatAgentTranscript([{
    id: "result-1",
    kind: "result",
    content: "",
    timestamp: "2026-06-11T00:00:00.000Z",
    metadata: {
      cancelled: true,
      turnOutcome: {
        status: "cancelled",
        mode: "graceful",
        reason: "user_cancelled",
        message: "已停止本次执行。",
        diagnostics: [{
          source: "claude-sdk",
          kind: "aborted",
          message: "Request was aborted",
        }],
      },
    },
  }])

  expect(text).toContain("已停止本次执行。")
  expect(text).not.toContain("Request was aborted")
})
```

Add to `desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts`:

```ts
it("closes active phases as done for cancelled terminal phase", () => {
  const current = [
    mkItem({ id: "p1", runId: "run-1", phase: "streaming", status: "in-progress" }),
  ]

  const next = reducePhaseEvent(current, {
    runId: "run-1",
    conversationId: "conversation-1",
    phase: "cancelled",
    status: "done",
    startedAt: "2026-06-11T00:00:01.000Z",
    completedAt: "2026-06-11T00:00:02.000Z",
  })

  expect(findPhase(next, "streaming")).toMatchObject({
    status: "done",
    completedAt: "2026-06-11T00:00:02.000Z",
  })
  expect(findPhase(next, "cancelled")).toMatchObject({
    status: "done",
  })
})
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/agent-transcript.test.ts desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts
```

Expected: FAIL until transcript and phase reducer handle structured cancellation.

- [ ] **Step 3: Export outcome copy in transcripts**

Modify `desktop/src/lib/agent-transcript.ts`, in `timelineItemText`:

```ts
    case "result": {
      const outcome = entry.metadata?.turnOutcome
      if (outcome?.status === "cancelled" || outcome?.status === "timed_out" || outcome?.status === "interrupted") {
        return redactSensitiveText(outcome.message)
      }
      return redactSensitiveText(entry.content)
    }
```

- [ ] **Step 4: Keep terminal phase behavior consistent**

Modify `desktop/src/modules/agent/utils/phase-reducer.ts` so `cancelled` behaves as a terminal close event that closes previous in-progress phases as `done`, not `failed`. The terminal scope helper should continue matching `cancelled`, and the close status should come from the event:

```ts
const closeStatus = event.phase === "failed" ? "failed" : event.status
```

Use `closeStatus` when mutating previous in-progress phases.

- [ ] **Step 5: Run tests and commit**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run desktop/src/lib/__tests__/agent-transcript.test.ts desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts
```

Expected: PASS.

Commit:

```bash
git add desktop/src/lib/agent-transcript.ts desktop/src/modules/agent/utils/phase-reducer.ts desktop/src/lib/__tests__/agent-transcript.test.ts desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts
git commit -m "feat(agent): align cancelled outcomes in history exports"
```

---

### Task 6: Release Note And Full Verification

**Files:**
- Modify: `RELEASE_NOTES_PENDING.md`

- [ ] **Step 1: Add release note**

Add one bullet to the current unreleased section in `RELEASE_NOTES_PENDING.md`:

```md
- Agent 手动停止后的结果会按“已停止”展示，不再把底层 SDK 中断误报成执行失败；真实网络或供应商中断仍会按失败提示。
```

- [ ] **Step 2: Run focused test suite**

Run:

```bash
pnpm --filter @synapse/desktop exec vitest run \
  desktop/electron/services/agent-runtime/__tests__/turn-outcome.test.ts \
  desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts \
  desktop/electron/services/agent-runtime/__tests__/claude-sdk-session.test.ts \
  desktop/src/lib/__tests__/agent-timeline.test.ts \
  desktop/src/modules/agent/components/__tests__/agent-timeline-item.test.tsx \
  desktop/src/lib/__tests__/agent-transcript.test.ts \
  desktop/src/modules/agent/utils/__tests__/phase-reducer.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run hard constraints and type-adjacent tests**

Run:

```bash
pnpm --filter @synapse/desktop run check:hard-constraints
```

Expected: PASS.

Run:

```bash
pnpm --filter @synapse/desktop run test
```

Expected: PASS.

- [ ] **Step 4: Inspect diff for UI discipline and scope**

Run:

```bash
git diff --check
rg -n "style=\\{\\{|#[0-9a-fA-F]{3,8}|bg-\\[|text-\\[|console\\.log" desktop/src desktop/electron RELEASE_NOTES_PENDING.md
```

Expected:
- `git diff --check` prints nothing.
- `rg` prints no new violations from this implementation. Existing unrelated matches must be left untouched and noted in the final summary.

- [ ] **Step 5: Commit**

```bash
git add RELEASE_NOTES_PENDING.md
git commit -m "docs: note agent cancellation outcome fix"
```

---

## Self-Review

- Spec coverage: The plan covers lifecycle types, cancel intent, SDK outcome normalization, terminal locking, renderer projection, history/export, and release note.
- Scope: The plan does not redesign the composer, change providers, alter queue semantics, or add retry/resume behavior.
- Type consistency: `AgentTurnOutcome`, `AgentTurnDiagnostic`, `TurnLifecycle`, `turnOutcome`, and `cancelIntent` are named consistently across tasks.
- Test strategy: Each behavior has a failing test before implementation, and full verification includes focused tests plus desktop hard constraints.
