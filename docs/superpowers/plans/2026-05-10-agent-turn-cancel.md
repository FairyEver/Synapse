# Agent Turn Cancel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users stop a running Agent turn via a tiered stop mechanism (graceful cancel → 5s timeout → hard kill).

**Architecture:** Extend `AgentLiveSession` with optional `cancelCurrentTurn()`. Add `cancelTurn()` / `forceKillTurn()` to `AgentRuntimeService`, exposed via two new IPC channels. Renderer hooks track cancel phase and the composer button transitions between send / stop / force-stop states.

**Tech Stack:** TypeScript, Electron IPC, Vitest, React hooks, shadcn/ui Button, Lucide icons

**Spec:** `docs/superpowers/specs/2026-05-10-agent-turn-cancel-design.md`

---

## File Map

### Main process (Electron)

| File | Responsibility |
|------|---------------|
| `desktop/electron/services/agent-runtime/types.ts` | Add `cancelCurrentTurn?()` to `AgentLiveSession`, `abortSignal` to `AgentExecutionContext`, `cancelled` to `AgentResultMetadata`, new `CancelTurnResult` type |
| `desktop/electron/services/agent-runtime/session-lifecycle.ts` | Add `turnAbortController` and `cancelState` fields to `RuntimeSessionState` |
| `desktop/electron/services/agent-runtime/agent-runtime-service.ts` | Add `cancelTurn()`, `forceKillTurn()`, `clearCancelState()`, `emitCancelEscalation()` methods |
| `desktop/electron/services/agent-runtime/message-router.ts` | Inject `AbortController` per turn in `processQueue`, propagate to exec path, add `buildCancelledResult()` |
| `desktop/electron/modules/agent/ipc-messages.ts` | Add `cancelTurn` and `forceKillTurn` IPC method descriptors |
| `desktop/electron/modules/agent/ipc-shared.ts` | Add `cancel_pending` / `cancelled` to phase enum, `cancelled` to result metadata schema |
| `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts` | New test file for cancel functionality |

### Renderer

| File | Responsibility |
|------|---------------|
| `desktop/src/types/agent.ts` | Add `cancel_pending` / `cancelled` to `SynapseAgentPhaseValue` |
| `desktop/src/types/bridge.ts` | Add `cancelTurn()` / `forceKillTurn()` to agent bridge |
| `desktop/src/modules/agent/hooks/use-chat-reducer.ts` | Add `cancelPhase` state and 3 new action types |
| `desktop/src/modules/agent/hooks/use-chat-connection.ts` | Add `cancelTurn()` and `forceKillTurn()` functions |
| `desktop/src/modules/agent/hooks/use-chat-events.ts` | Handle `cancel_pending` / `cancelled` phase events |
| `desktop/src/modules/agent/components/agent-composer.tsx` | Add stop / force-stop button states |
| `desktop/src/modules/agent/index.tsx` | Wire cancel props through to composer |

---

## Task 1: Type Foundation (Main Process)

**Files:**
- Modify: `desktop/electron/services/agent-runtime/types.ts:95-192`
- Modify: `desktop/electron/services/agent-runtime/session-lifecycle.ts:5-16`

- [ ] **Step 1: Add `cancelled` to `AgentResultMetadata`**

```typescript
// types.ts — inside AgentResultMetadata, after the `workDir` line
  readonly cancelled?: boolean
```

- [ ] **Step 2: Add `abortSignal` to `AgentExecutionContext`**

```typescript
// types.ts — inside AgentExecutionContext, after the `modeOverride` line
  readonly abortSignal?: AbortSignal
```

- [ ] **Step 3: Add `cancelCurrentTurn` to `AgentLiveSession`**

```typescript
// types.ts — inside AgentLiveSession, after the `close()` line
  cancelCurrentTurn?(): Promise<boolean>
```

- [ ] **Step 4: Add `CancelTurnResult` type**

```typescript
// types.ts — after ScheduledAgentSendResult
export type CancelTurnResult = {
  readonly status: "no-active-turn" | "graceful-pending" | "hard-killed"
}
```

- [ ] **Step 5: Add cancel state fields to `RuntimeSessionState`**

```typescript
// session-lifecycle.ts — inside RuntimeSessionState, after `pending?`
  turnAbortController?: AbortController
  cancelState?: {
    requestedAt: number
    escalationTimer?: ReturnType<typeof setTimeout>
  }
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 7: Commit**

```bash
git add desktop/electron/services/agent-runtime/types.ts desktop/electron/services/agent-runtime/session-lifecycle.ts
git commit -m "feat(agent-runtime): add cancel turn type foundations"
```

---

## Task 2: MessageRouter — AbortController Injection & Cancel Result

**Files:**
- Modify: `desktop/electron/services/agent-runtime/message-router.ts:301-377` (processQueue, processTurn)
- Modify: `desktop/electron/services/agent-runtime/message-router.ts:645-687` (processExecTurn)

- [ ] **Step 1: Add `buildCancelledResult` method to MessageRouter**

Add after the `finishWithError` method (~line 883):

```typescript
  buildCancelledResult(
    message: AgentMessage,
    conversationIdValue: string,
  ): AgentRuntimeTurnResult {
    const cancelEvent: AgentEvent = {
      type: "result",
      content: "",
      done: true,
      metadata: { cancelled: true },
    }
    this.emitEvent(message, conversationIdValue, cancelEvent)
    return {
      conversationId: conversationIdValue,
      events: [cancelEvent],
      resultText: "",
      error: "cancelled",
    }
  }

  clearCancelState(state: RuntimeSessionState): void {
    if (state.cancelState?.escalationTimer) {
      clearTimeout(state.cancelState.escalationTimer)
    }
    state.cancelState = undefined
  }
```

- [ ] **Step 2: Inject AbortController in `processQueue`**

Replace the body of the existing `while` loop inside `processQueue` (lines ~304-318):

```typescript
  private async processQueue(state: RuntimeSessionState): Promise<void> {
    state.busy = true
    try {
      while (state.queue.length > 0) {
        const turn = state.queue.shift()
        if (!turn) continue
        const ac = new AbortController()
        state.turnAbortController = ac
        try {
          const result = await this.processTurn(state, turn.message, turn.conversationId)
          turn.resolve(result)
        } catch (error) {
          if (ac.signal.aborted) {
            turn.resolve(this.buildCancelledResult(turn.message, turn.conversationId))
          } else {
            const messageText = error instanceof Error ? error.message : String(error)
            this.deps.logger?.warn("AgentRuntime queued turn failed.", {
              error: messageText,
              projectId: this.deps.projectId,
              sessionKey: turn.message.sessionKey,
            })
            turn.resolve(this.finishWithError(turn.message, turn.conversationId, messageText))
          }
        } finally {
          state.turnAbortController = undefined
          this.clearCancelState(state)
        }
      }
    } finally {
      state.busy = false
    }
  }
```

- [ ] **Step 3: Pass `abortSignal` into `processExecTurn`**

In `processExecTurn` (line ~653), add `abortSignal` to the execution context. The `state` is available in the caller `processTurn`. We need to thread it through.

Add `abortSignal` parameter to `processExecTurn`:

```typescript
  private async processExecTurn(
    message: AgentMessage,
    conversation: ConversationEntryV1,
    adapter: AgentAdapter,
    workDir: string,
    abortSignal?: AbortSignal,
  ): Promise<AgentRuntimeTurnResult> {
```

And inside the `adapter.execute` call, add `abortSignal`:

```typescript
    const execution = await adapter.execute(message, {
      projectId: this.deps.projectId,
      workDir,
      threadId,
      agentSessionId: threadId,
      sessionEnv: this.deps.replyTargets?.getAgentEnv(this.deps.projectId, message.sessionKey),
      processIsolation: await this.callbacks.resolveProcessIsolation(message),
      actor: { kind: "user" },
      abortSignal,
      onEvent: (event) => {
        streamedEvents.add(event)
        this.emitEvent(message, conversation.id, event)
      },
    })
```

Then in `processTurn`, pass `state.turnAbortController?.signal` to `processExecTurn`:

```typescript
      return this.processExecTurn(message, conversation, adapter, workDir, state.turnAbortController?.signal)
```

The `state` is already available in `processTurn` — it's the first parameter.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/services/agent-runtime/message-router.ts
git commit -m "feat(agent-runtime): inject AbortController per turn in MessageRouter"
```

---

## Task 3: AgentRuntimeService — cancelTurn & forceKillTurn

**Files:**
- Modify: `desktop/electron/services/agent-runtime/agent-runtime-service.ts`

- [ ] **Step 1: Add import for `CancelTurnResult`**

Add `CancelTurnResult` to the imports from `./types`:

```typescript
import type {
  // ... existing imports ...
  CancelTurnResult,
} from "./types"
```

- [ ] **Step 2: Add `cancelTurn` method**

Add after `sendScheduled` method (~line 288):

```typescript
  async cancelTurn(conversationId: string): Promise<CancelTurnResult> {
    const state = this.states.get(conversationId)
    if (!state || !state.busy) {
      return { status: "no-active-turn" }
    }
    if (state.cancelState) {
      return { status: state.cancelState.escalationTimer ? "graceful-pending" : "hard-killed" }
    }

    state.cancelState = { requestedAt: Date.now() }

    if (state.pending) {
      this.pendingPermissions.delete(state.pending.requestId)
      state.pending.resolve()
      state.pending = undefined
    }

    const liveSession = state.liveSession
    if (liveSession) {
      let gracefulSent = false
      if (liveSession.cancelCurrentTurn) {
        try {
          gracefulSent = await liveSession.cancelCurrentTurn()
        } catch {
          gracefulSent = false
        }
      }
      if (!gracefulSent) {
        await liveSession.close()
        state.liveSession = undefined
        return { status: "hard-killed" }
      }
      state.cancelState.escalationTimer = setTimeout(() => {
        this.emitCancelEscalation(conversationId)
      }, 5000)
      return { status: "graceful-pending" }
    }

    if (state.turnAbortController) {
      state.turnAbortController.abort("user-cancel")
      return { status: "hard-killed" }
    }

    return { status: "no-active-turn" }
  }
```

- [ ] **Step 3: Add `forceKillTurn` method**

```typescript
  async forceKillTurn(conversationId: string): Promise<CancelTurnResult> {
    const state = this.states.get(conversationId)
    if (!state || !state.busy) {
      return { status: "no-active-turn" }
    }
    this.messageRouter.clearCancelState(state)
    state.turnAbortController?.abort("force-kill")
    if (state.liveSession) {
      await state.liveSession.close()
      state.liveSession = undefined
    }
    return { status: "hard-killed" }
  }
```

- [ ] **Step 4: Add `emitCancelEscalation` private method**

```typescript
  private emitCancelEscalation(conversationId: string): void {
    this.deps.eventBus?.emit({
      domain: "agent",
      type: "phase.update",
      payload: {
        runId: conversationId,
        projectId: this.deps.projectId,
        sessionKey: "",
        phase: "cancel_pending",
        status: "in-progress",
        startedAt: new Date().toISOString(),
      },
      scope: { sessionId: conversationId },
      timestamp: new Date().toISOString(),
    })
  }
```

- [ ] **Step 5: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 6: Commit**

```bash
git add desktop/electron/services/agent-runtime/agent-runtime-service.ts
git commit -m "feat(agent-runtime): add cancelTurn and forceKillTurn to AgentRuntimeService"
```

---

## Task 4: Unit Tests for Cancel

**Files:**
- Create: `desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`

- [ ] **Step 1: Write cancel test file**

```typescript
import { describe, expect, it, vi } from "vitest"

import type {
  ConversationEntryV1,
  DataChangeEvent,
  DataChangeListener,
  DataNamespace,
} from "../../../runtime/data-repo"
import type { ScopedEventBus } from "../../../runtime/project-container"
import { AgentRuntimeService, conversationId } from "../agent-runtime-service"
import type {
  AgentAdapter,
  AgentEvent,
  AgentExecutionContext,
  AgentExecutionResult,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"

describe("AgentRuntimeService cancelTurn", () => {
  it("returns no-active-turn when conversation has no busy state", async () => {
    const service = createService(new NeverResolveAdapter())
    const result = await service.cancelTurn("nonexistent")
    expect(result).toEqual({ status: "no-active-turn" })
  })

  it("hard-kills a live session that does not support graceful cancel", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const cancel = await service.cancelTurn(
      conversationId("local", "s1", "active"),
    )
    expect(cancel).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    const result = await sendPromise
    expect(result.error).toBe("cancelled")
  })

  it("returns graceful-pending for a session that supports cancel", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const cancel = await service.cancelTurn(
      conversationId("local", "s1", "active"),
    )
    expect(cancel).toEqual({ status: "graceful-pending" })
    expect(session.cancelCalled).toBe(true)
    expect(session.closed).toBe(false)

    session.emitResult("stopped")
    const result = await sendPromise
    expect(result.resultText).toBe("stopped")
  })

  it("is idempotent — second cancelTurn returns current state", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)
    const second = await service.cancelTurn(convId)
    expect(second.status).toBe("hard-killed")

    await sendPromise
  })

  it("forceKillTurn closes live session after graceful pending", async () => {
    const session = new CancellableLiveSession({ graceful: true })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)
    expect(session.closed).toBe(false)

    const force = await service.forceKillTurn(convId)
    expect(force).toEqual({ status: "hard-killed" })
    expect(session.closed).toBe(true)

    await sendPromise
  })

  it("cancel during exec mode aborts via AbortController", async () => {
    const adapter = new SlowExecAdapter()
    const service = createService(adapter)

    const sendPromise = service.send(baseMessage("hello"))
    await waitForBusy(service, "hello")

    const convId = conversationId("local", "s1", "active")
    const cancel = await service.cancelTurn(convId)
    expect(cancel).toEqual({ status: "hard-killed" })

    adapter.resolveExec()
    const result = await sendPromise
    expect(result.error).toBe("cancelled")
  })

  it("queue continues after cancel — next turn executes", async () => {
    const session = new CancellableLiveSession({ graceful: false })
    const adapter = new CancellableLiveAdapter(session)
    const service = createService(adapter)

    const send1 = service.send(baseMessage("first"))
    await waitForBusy(service, "first")
    const send2 = service.send(baseMessage("second"))

    const convId = conversationId("local", "s1", "active")
    await service.cancelTurn(convId)

    const r1 = await send1
    expect(r1.error).toBe("cancelled")

    const session2 = adapter.lastCreatedSession!
    session2.emitResult("done-2")

    const r2 = await send2
    expect(r2.resultText).toBe("done-2")
  })
})

// ─── Test helpers ─────────────────────────────────────────────────────────────

function fixedNow(): Date {
  return new Date("2026-05-10T00:00:00.000Z")
}

function baseMessage(content: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "s1",
    platform: "local",
    userId: "user-1",
    content,
  }
}

function createService(adapter: AgentAdapter): AgentRuntimeService {
  const conversations = new MemoryNamespace<ConversationEntryV1>("conversations")
  return new AgentRuntimeService({
    projectId: "project-1",
    workDir: "/repo",
    conversations,
    adapter,
    now: fixedNow,
  })
}

async function waitForBusy(service: AgentRuntimeService, _hint: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const status = service.getStatus()
    if (status.busySessions > 0) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error("Timed out waiting for busy state")
}

class CancellableLiveSession implements AgentLiveSession {
  readonly agentType = "claude-code"
  closed = false
  cancelCalled = false
  private readonly queue: Array<(v: AgentEvent | null) => void> = []
  private readonly events: AgentEvent[] = []
  private readonly supportsGraceful: boolean

  constructor(opts: { graceful: boolean }) {
    this.supportsGraceful = opts.graceful
  }

  async send(): Promise<void> {}

  async respondPermission(): Promise<void> {}

  nextEvent(): Promise<AgentEvent | null> {
    const buffered = this.events.shift()
    if (buffered) return Promise.resolve(buffered)
    if (this.closed) return Promise.resolve(null)
    return new Promise((resolve) => {
      this.queue.push(resolve)
    })
  }

  currentSessionId(): string | undefined {
    return "test-session-1"
  }

  alive(): boolean {
    return !this.closed
  }

  async close(): Promise<void> {
    this.closed = true
    for (const waiter of this.queue) waiter(null)
    this.queue.length = 0
  }

  cancelCurrentTurn = this.supportsGraceful
    ? async (): Promise<boolean> => {
        this.cancelCalled = true
        return true
      }
    : undefined

  emitResult(text: string): void {
    const event: AgentEvent = {
      type: "result",
      content: text,
      done: true,
      agentSessionId: "test-session-1",
      threadId: "test-session-1",
    }
    const waiter = this.queue.shift()
    if (waiter) {
      waiter(event)
    } else {
      this.events.push(event)
    }
  }
}

class CancellableLiveAdapter implements AgentAdapter {
  readonly agentType = "claude-code"
  lastCreatedSession: CancellableLiveSession | undefined
  private readonly initialSession: CancellableLiveSession

  constructor(session: CancellableLiveSession) {
    this.initialSession = session
  }

  async execute(): Promise<AgentExecutionResult> {
    throw new Error("not used")
  }

  async startSession(): Promise<AgentLiveSession> {
    if (!this.lastCreatedSession || this.initialSession.closed) {
      this.lastCreatedSession = this.initialSession.closed
        ? new CancellableLiveSession({ graceful: false })
        : this.initialSession
    }
    return this.lastCreatedSession
  }
}

class SlowExecAdapter implements AgentAdapter {
  readonly agentType = "hermes"
  private execResolve?: (result: AgentExecutionResult) => void

  async execute(
    _message: AgentMessage,
    context: AgentExecutionContext,
  ): Promise<AgentExecutionResult> {
    return new Promise<AgentExecutionResult>((resolve, reject) => {
      this.execResolve = resolve
      context.abortSignal?.addEventListener("abort", () => {
        reject(new Error("aborted"))
      }, { once: true })
    })
  }

  resolveExec(): void {
    this.execResolve?.({
      events: [],
      resultText: "late-result",
    })
  }
}

class MemoryNamespace<T extends { id: string }> implements DataNamespace<T> {
  readonly schemaVersion = 1
  readonly backend = "json" as const
  readonly name: string
  private readonly values = new Map<string, T>()
  private readonly listeners: DataChangeListener<T>[] = []

  constructor(name: string) {
    this.name = name
  }

  async getSingleton(): Promise<T | null> { return null }
  async setSingleton(): Promise<void> {}

  async list(filter?: Partial<T>): Promise<T[]> {
    const values = [...this.values.values()]
    if (!filter) return values
    return values.filter((v) =>
      Object.entries(filter).every(([k, e]) =>
        (v as Record<string, unknown>)[k] === e,
      ),
    )
  }

  async get(id: string): Promise<T | null> {
    return this.values.get(id) ?? null
  }

  snapshot(id: string): T | null {
    return this.values.get(id) ?? null
  }

  async upsert(item: T): Promise<void> {
    const previous = this.values.get(item.id)
    this.values.set(item.id, item)
    this.emit({ namespace: this.name, kind: "upsert", id: item.id, value: item, previous, timestamp: new Date().toISOString() })
  }

  async remove(id: string): Promise<void> {
    const previous = this.values.get(id)
    this.values.delete(id)
    this.emit({ namespace: this.name, kind: "remove", id, previous, timestamp: new Date().toISOString() })
  }

  onChange(listener: DataChangeListener<T>): () => void {
    this.listeners.push(listener)
    return () => {
      const i = this.listeners.indexOf(listener)
      if (i >= 0) this.listeners.splice(i, 1)
    }
  }

  private emit(event: DataChangeEvent<T>): void {
    for (const l of this.listeners) l(event)
  }
}
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts`
Expected: All tests pass. If some fail because of `getStatus()` or `conversationId` signature differences, adjust the helpers to match the actual API. The test code above uses patterns from the existing `agent-runtime-service.test.ts`.

- [ ] **Step 3: Commit**

```bash
git add desktop/electron/services/agent-runtime/__tests__/agent-runtime-cancel.test.ts
git commit -m "test(agent-runtime): add cancel turn unit tests"
```

---

## Task 5: IPC Layer — cancelTurn & forceKillTurn Channels

**Files:**
- Modify: `desktop/electron/modules/agent/ipc-messages.ts`
- Modify: `desktop/electron/modules/agent/ipc-shared.ts:99-114`

- [ ] **Step 1: Add `cancel_pending` and `cancelled` to phase enum in `ipc-shared.ts`**

In `ipc-shared.ts`, the phase enum at line ~99:

```typescript
    phase: z.enum([
      "submitted",
      "received",
      "runtime_starting",
      "runtime_ready",
      "request_submitted",
      "awaiting_first_token",
      "streaming",
      "completed",
      "failed",
      "cancel_pending",
      "cancelled",
    ]),
```

Also add `cancelled` to the result metadata schema at line ~88:

```typescript
    metadata: z.object({
      model: z.string().optional(),
      effort: z.string().optional(),
      contextRemainingPercent: z.number().optional(),
      workDir: z.string().optional(),
      cancelled: z.boolean().optional(),
    }).optional(),
```

- [ ] **Step 2: Add IPC methods in `ipc-messages.ts`**

Add after the imports at the top:

```typescript
import type { CancelTurnResult } from "../../services/agent-runtime/types"
```

Add new schemas after `respondPermissionResultSchema`:

```typescript
const cancelTurnRequestSchema = projectRequestSchema.extend({
  conversationId: z.string().min(1),
})

const cancelTurnResultSchema = z.object({
  status: z.enum(["no-active-turn", "graceful-pending", "hard-killed"]),
})
```

Add new methods inside `messageMethods`:

```typescript
  cancelTurn: {
    kind: "invoke",
    channel: "synapse:agent:cancel-turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.cancelTurn(request.conversationId)
    },
  },
  forceKillTurn: {
    kind: "invoke",
    channel: "synapse:agent:force-kill-turn",
    request: cancelTurnRequestSchema,
    response: cancelTurnResultSchema,
    handler: async (ctx, request: z.infer<typeof cancelTurnRequestSchema>) => {
      const { agent } = await resolveProjectAgent(ctx.resolve, request.projectId)
      return agent.forceKillTurn(request.conversationId)
    },
  },
```

- [ ] **Step 3: Regenerate IPC channel types**

Run: `pnpm --filter @synapse/desktop run generate:ipc 2>&1 | tail -5`

If there is no `generate:ipc` script, check if IPC channels auto-register. Look at `desktop/electron/generated/ipc-channels.generated.ts` — if it exists and is auto-generated, run whatever generates it. If manually maintained, no action needed.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add desktop/electron/modules/agent/ipc-messages.ts desktop/electron/modules/agent/ipc-shared.ts
git commit -m "feat(agent-ipc): add cancelTurn and forceKillTurn IPC channels"
```

---

## Task 6: Renderer Types

**Files:**
- Modify: `desktop/src/types/agent.ts:61-69`
- Modify: `desktop/src/types/bridge.ts:426-465`

- [ ] **Step 1: Add phase values to `SynapseAgentPhaseValue`**

In `agent.ts`, add to `SynapseAgentPhaseValue`:

```typescript
export type SynapseAgentPhaseValue =
  | "submitted"
  | "received"
  | "runtime_starting"
  | "runtime_ready"
  | "request_submitted"
  | "awaiting_first_token"
  | "streaming"
  | "completed"
  | "failed"
  | "cancel_pending"
  | "cancelled"
```

- [ ] **Step 2: Add `cancelled` to `SynapseAgentResultTimelineItem` metadata**

In `agent.ts`, inside `SynapseAgentResultTimelineItem.metadata`:

```typescript
  readonly metadata?: {
    readonly model?: string
    readonly effort?: string
    readonly contextRemainingPercent?: number
    readonly workDir?: string
    readonly cancelled?: boolean
  }
```

- [ ] **Step 3: Add cancel methods to bridge agent type**

In `bridge.ts`, inside the `agent` section (after `openReference`):

```typescript
    cancelTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<{ status: "no-active-turn" | "graceful-pending" | "hard-killed" }>
    forceKillTurn: (
      args: { projectId: string; conversationId: string },
    ) => Promise<{ status: "no-active-turn" | "graceful-pending" | "hard-killed" }>
```

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: Errors about preload not exposing the new methods — that's expected. The preload wiring will be auto-handled by the IPC module registration from Task 5.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/types/agent.ts desktop/src/types/bridge.ts
git commit -m "feat(renderer-types): add cancel turn types to agent and bridge"
```

---

## Task 7: Renderer Hooks — Cancel State & Actions

**Files:**
- Modify: `desktop/src/modules/agent/hooks/use-chat-reducer.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-connection.ts`
- Modify: `desktop/src/modules/agent/hooks/use-chat-events.ts`

- [ ] **Step 1: Add cancel state and actions to `use-chat-reducer.ts`**

Add `cancelPhase` to `ChatState`:

```typescript
type ChatState = {
  // ... existing fields ...
  cancelPhase: Map<string, "none" | "graceful-pending" | "force-available">
}
```

Add new action types to `ChatAction`:

```typescript
  | { type: "CANCEL_TURN_REQUESTED"; conversationId: string }
  | { type: "CANCEL_ESCALATION_AVAILABLE"; conversationId: string }
  | { type: "CANCEL_COMPLETED"; conversationId: string }
```

Add initial state:

```typescript
  cancelPhase: new Map(),
```

Add reducer cases:

```typescript
    case "CANCEL_TURN_REQUESTED": {
      const next = new Map(state.cancelPhase)
      next.set(action.conversationId, "graceful-pending")
      return { ...state, cancelPhase: next }
    }
    case "CANCEL_ESCALATION_AVAILABLE": {
      const next = new Map(state.cancelPhase)
      next.set(action.conversationId, "force-available")
      return { ...state, cancelPhase: next }
    }
    case "CANCEL_COMPLETED": {
      const next = new Map(state.cancelPhase)
      next.delete(action.conversationId)
      return { ...state, cancelPhase: next }
    }
```

Also in the `REMOVE_SENDING_CONVERSATION` case, clean up cancelPhase:

```typescript
    case "REMOVE_SENDING_CONVERSATION": {
      const nextSending = new Set(state.sendingConversationIds)
      nextSending.delete(action.conversationId)
      const nextCancel = new Map(state.cancelPhase)
      nextCancel.delete(action.conversationId)
      return { ...state, sendingConversationIds: nextSending, cancelPhase: nextCancel }
    }
```

And in `RESET`:

```typescript
      cancelPhase: new Map(),
```

- [ ] **Step 2: Add cancel functions to `use-chat-connection.ts`**

Add to `ChatConnectionResult` type:

```typescript
  readonly cancelTurn: () => Promise<void>
  readonly forceKillTurn: () => Promise<void>
```

Add the implementations inside `useChatConnection`:

```typescript
  const cancelTurn = useCallback(async () => {
    const conversationId = selectedConversationIdRef.current
    const projectId = getDefaultProjectId()
    if (!conversationId || !projectId) return
    const bridge = requireSynapseBridge()
    dispatch({ type: "CANCEL_TURN_REQUESTED", conversationId })
    try {
      const result = await bridge.agent.cancelTurn({ projectId, conversationId })
      if (result.status === "hard-killed") {
        dispatch({ type: "CANCEL_COMPLETED", conversationId })
      }
    } catch (error) {
      logger.error("cancelTurn failed", error)
      dispatch({ type: "CANCEL_COMPLETED", conversationId })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef])

  const forceKillTurn = useCallback(async () => {
    const conversationId = selectedConversationIdRef.current
    const projectId = getDefaultProjectId()
    if (!conversationId || !projectId) return
    const bridge = requireSynapseBridge()
    try {
      await bridge.agent.forceKillTurn({ projectId, conversationId })
    } catch (error) {
      logger.error("forceKillTurn failed", error)
    } finally {
      dispatch({ type: "CANCEL_COMPLETED", conversationId })
    }
  }, [dispatch, getDefaultProjectId, selectedConversationIdRef])
```

Return them in the result object.

- [ ] **Step 3: Handle cancel phase events in `use-chat-events.ts`**

Inside the `phase.update` event handler, add a check for `cancel_pending`:

```typescript
        if (payload.phase === "cancel_pending") {
          if (payload.conversationId) {
            dispatch({ type: "CANCEL_ESCALATION_AVAILABLE", conversationId: payload.conversationId })
          }
          return
        }
        if (payload.phase === "cancelled") {
          if (payload.conversationId) {
            dispatch({ type: "CANCEL_COMPLETED", conversationId: payload.conversationId })
            dispatch({ type: "REMOVE_SENDING_CONVERSATION", conversationId: payload.conversationId })
          }
          return
        }
```

Add these checks **before** the existing `failed` / `completed` check.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors (or only preload-related ones that resolve after IPC registration).

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/hooks/use-chat-reducer.ts desktop/src/modules/agent/hooks/use-chat-connection.ts desktop/src/modules/agent/hooks/use-chat-events.ts
git commit -m "feat(agent-hooks): add cancelTurn/forceKillTurn state and actions"
```

---

## Task 8: UI — Composer Stop Button

**Files:**
- Modify: `desktop/src/modules/agent/components/agent-composer.tsx`
- Modify: `desktop/src/modules/agent/index.tsx`

- [ ] **Step 1: Extend `AgentComposer` props and add stop button**

```typescript
import { type FormEvent, type KeyboardEvent, useRef, useEffect, useState } from "react"
import { ArrowUp, Square, Loader2 } from "lucide-react"
import "./agent-composer.css"

const SINGLE_LINE_HEIGHT = 28

type CancelPhaseValue = "none" | "graceful-pending" | "force-available"

function AgentComposer({
  draft,
  disabled,
  canSend,
  sending,
  cancelPhase,
  onDraftChange,
  onInputKeyDown,
  onSubmit,
  onCancel,
  onForceKill,
}: {
  readonly draft: string
  readonly disabled: boolean
  readonly canSend: boolean
  readonly sending: boolean
  readonly cancelPhase: CancelPhaseValue
  readonly onDraftChange: (value: string) => void
  readonly onInputKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  readonly onSubmit: (event: FormEvent) => void
  readonly onCancel: () => void
  readonly onForceKill: () => void
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [multiline, setMultiline] = useState(false)

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    const scrollHeight = Math.min(el.scrollHeight, 120)
    el.style.height = `${scrollHeight}px`
    setMultiline(scrollHeight > SINGLE_LINE_HEIGHT)
  }, [draft])

  const renderActionButton = () => {
    if (sending && cancelPhase === "force-available") {
      return (
        <button
          type="button"
          className="agent-composer__send agent-composer__send--destructive"
          onClick={onForceKill}
          aria-label="强制停止"
        >
          <Square size={14} strokeWidth={2.5} />
        </button>
      )
    }
    if (sending && cancelPhase === "graceful-pending") {
      return (
        <button
          type="button"
          className="agent-composer__send"
          disabled
          aria-label="停止中"
        >
          <Loader2 size={14} strokeWidth={2.5} className="animate-spin" />
        </button>
      )
    }
    if (sending) {
      return (
        <button
          type="button"
          className="agent-composer__send"
          onClick={onCancel}
          aria-label="停止"
        >
          <Square size={14} strokeWidth={2.5} />
        </button>
      )
    }
    return (
      <button
        type="submit"
        className="agent-composer__send"
        disabled={!canSend}
        aria-label="发送"
      >
        <ArrowUp size={14} strokeWidth={2.5} />
      </button>
    )
  }

  return (
    <form className="agent-composer" onSubmit={onSubmit}>
      <div
        className="agent-composer__container"
        data-multiline={multiline || undefined}
      >
        <textarea
          ref={textareaRef}
          className="agent-composer__input"
          value={draft}
          onChange={(e) => onDraftChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          placeholder="输入消息"
          disabled={disabled || sending}
          rows={1}
        />
        {renderActionButton()}
      </div>
    </form>
  )
}

export { AgentComposer }
```

- [ ] **Step 2: Add destructive stop button style to `agent-composer.css`**

Add at the end of the file:

```css
.agent-composer__send--destructive {
  color: hsl(var(--destructive));
}
```

- [ ] **Step 3: Wire cancel props in `index.tsx`**

In `index.tsx`, update the `AgentComposer` usage (line ~303):

```tsx
            <AgentComposer
              draft={draft}
              disabled={!chat.activeProjectId}
              canSend={Boolean(draft.trim() && chat.activeProjectId)}
              sending={chat.sending}
              cancelPhase={
                chat.selectedConversationId
                  ? (chat.cancelPhase?.get(chat.selectedConversationId) ?? "none")
                  : "none"
              }
              onDraftChange={setDraft}
              onInputKeyDown={handleInputKeyDown}
              onSubmit={handleSubmit}
              onCancel={() => void chat.cancelTurn()}
              onForceKill={() => void chat.forceKillTurn()}
            />
```

`chat.sending` is already exposed from `useAgentChat` (derived from `sendingConversationIds`). The new properties need to be wired through:

In `use-agent-chat.ts`, add to the return type and return object:
- `cancelTurn: connection.cancelTurn`
- `forceKillTurn: connection.forceKillTurn`
- `cancelPhase: state.cancelPhase`

The file has null bytes — use `strings` or a hex editor to read it if the read tool fails. The pattern is: add to the interface type, add to the `return { ... }` object, and add `cancelPhase` to the `useMemo` deps or derived values.

- [ ] **Step 4: Verify types compile**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | head -30`
Expected: No new errors

- [ ] **Step 5: Commit**

```bash
git add desktop/src/modules/agent/components/agent-composer.tsx desktop/src/modules/agent/components/agent-composer.css desktop/src/modules/agent/index.tsx
git commit -m "feat(agent-ui): add stop/force-stop button to composer"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run all agent-runtime tests**

Run: `pnpm --filter @synapse/desktop exec vitest run desktop/electron/services/agent-runtime/__tests__/ 2>&1 | tail -20`
Expected: All tests pass including the new cancel tests

- [ ] **Step 2: Run full type check**

Run: `pnpm --filter @synapse/desktop exec tsc --noEmit --pretty 2>&1 | tail -20`
Expected: Clean

- [ ] **Step 3: Run hard constraints check**

Run: `pnpm --filter @synapse/desktop run check:hard-constraints 2>&1 | tail -10`
Expected: Pass

- [ ] **Step 4: Commit all remaining changes**

```bash
git add -A
git commit -m "feat(agent): agent turn cancel — tiered stop mechanism"
```
