# Agent Turn Lifecycle Outcome Design

Date: 2026-06-11

## Context

Synapse already supports graded Agent turn stopping: the first stop request sends a graceful interrupt, and the UI can escalate to a hard kill if the turn does not stop. That mechanism is documented in `2026-05-10-agent-turn-cancel-design.md` and is already reflected in runtime state such as `cancelState`, `turnAbortController`, `cancel_pending`, `cancelTurn`, and `forceKillTurn`.

A product gap remains: low-level SDK termination can still surface as a red execution failure even when the user intentionally stopped the turn. One concrete example is Claude SDK returning `Request was aborted` after `query.interrupt()`. The current error path treats that as a generic SDK query failure because the error classifier sees the diagnostic text but not the turn's lifecycle context.

This design upgrades Agent runtime from "SDK event stream plus UI status" to a turn lifecycle model with user intent, executor outcome, terminal product outcome, and diagnostics as separate concepts.

## Problem

The current runtime mixes several state vocabularies:

- UI state: `sending`, `cancel_pending`, `cancelled`.
- Runtime state: `busy`, queue items, `cancelState`, `turnAbortController`.
- SDK state: `query.next()`, `interrupt()`, `close()`, SDK result/error messages.
- Product display state: timeline errors, phase rows, result metadata.
- Diagnostic state: raw SDK text such as `Request was aborted`, `[ede_diagnostic]`, `stop_reason`.

Because these states are not reconciled through a single lifecycle authority, a user-initiated stop can later be overwritten by a low-level SDK error. The user sees "Agent 执行失败" even though the requested operation was "stop this turn".

## Goals

- Treat stop and force stop as first-class turn lifecycle intents, not as error handling side effects.
- Ensure each turn has exactly one terminal product outcome.
- Classify SDK abort/error events using lifecycle context before diagnostic text.
- Keep user-facing timeline, phase rows, history, export, and usage analysis aligned on the same product outcome.
- Preserve raw diagnostics for logs and detail views without exposing them as the main user message when the product outcome is cancellation.
- Avoid provider-specific string patches such as checking only for `Request was aborted`.

## Non-Goals

- Do not redesign the Agent composer or introduce new visual styling.
- Do not change model provider configuration, SDK settings, permission mode, tool policy, or MCP behavior.
- Do not swallow non-cancel network/provider aborts. If there is no cancel intent, abort-like diagnostics can still be failures.
- Do not change queue semantics. This design remains scoped to the active turn.
- Do not implement retry or resume behavior for cancelled turns.

## Design Principles

1. User intent beats executor wording. If the runtime has recorded a cancel intent, abort-like executor termination belongs to the cancellation path.
2. SDK adapters report low-level facts. They do not decide whether the product outcome is failed, cancelled, or timed out.
3. Renderer does not interpret SDK diagnostics. It renders product outcomes.
4. Terminal outcomes are locked. Late SDK events can append diagnostics but cannot change the main result.
5. Raw diagnostics are retained for debugging, but main timeline copy stays operational and user-centered.

## Concept Model

### Turn Intent Event

Turn intent events describe what the user or system requested.

```ts
type TurnIntentEvent =
  | { type: "turn.send" }
  | { type: "turn.cancel.requested"; mode: "graceful"; source: "user" | "system" }
  | { type: "turn.cancel.requested"; mode: "force"; source: "user" | "system" }
  | { type: "turn.timeout.requested"; source: "runtime" | "scheduler" | "relay" }
```

### Executor Event

Executor events describe what the SDK or process runner observed.

```ts
type ExecutorEvent =
  | { type: "executor.started" }
  | { type: "executor.message"; event: AgentEvent }
  | { type: "executor.result"; event: AgentEvent }
  | { type: "executor.error"; diagnostic: TurnDiagnostic }
  | { type: "executor.aborted"; diagnostic?: TurnDiagnostic }
  | { type: "executor.closed"; diagnostic?: TurnDiagnostic }
```

### Product Outcome

Product outcomes are the only terminal states consumed by timeline, phase rows, history, export, and user-facing result summaries.

```ts
type TurnOutcome =
  | { status: "completed"; message?: string }
  | { status: "cancelled"; mode: "graceful"; reason: "user_cancelled" | "system_cancelled" }
  | { status: "cancelled"; mode: "force"; reason: "force_cancelled" }
  | { status: "failed"; reason: TurnFailureReason; message: string }
  | { status: "timed_out"; reason: "runtime_timeout" | "relay_timeout" | "scheduler_timeout" }
  | { status: "interrupted"; reason: "tool_use_interrupted"; recoverable: true; message: string }
```

Failure reasons should be product categories, not raw SDK text:

```ts
type TurnFailureReason =
  | "provider_aborted"
  | "network_interrupted"
  | "permission_denied"
  | "permission_timeout"
  | "sdk_crashed"
  | "runtime_error"
  | "unknown"
```

### Turn Lifecycle

Each active turn gets a lifecycle record. It is the authority for intent, state, terminal outcome, and diagnostics.

```ts
interface TurnLifecycle {
  readonly turnId: string
  readonly conversationId: string
  state:
    | "queued"
    | "starting"
    | "running"
    | "cancelling"
    | "force_cancelling"
    | "timing_out"
    | "terminal"
  cancelIntent?: {
    readonly mode: "graceful" | "force"
    readonly source: "user" | "system"
    readonly requestedAt: string
  }
  timeoutIntent?: {
    readonly source: "runtime" | "scheduler" | "relay"
    readonly requestedAt: string
  }
  terminalOutcome?: TurnOutcome
  diagnostics: TurnDiagnostic[]
}
```

## Outcome Normalization

All executor termination goes through a normalizer that sees both the executor event and the lifecycle.

Decision order:

1. If `terminalOutcome` already exists, append any new diagnostic and do not change the product outcome.
2. If `cancelIntent` exists and the executor emits `error`, `aborted`, or `closed`, produce `cancelled` using the cancel mode.
3. If `timeoutIntent` exists and the executor emits `error`, `aborted`, or `closed`, produce `timed_out`.
4. If the executor emits the existing tool-use interrupted diagnostic, produce `interrupted` with `recoverable: true`.
5. If the executor emits a successful result before cancellation termination is observed, produce `completed`.
6. If the executor emits an error without cancel or timeout context, produce `failed`.

This deliberately means the same low-level diagnostic can map to different outcomes:

| Lifecycle context | Executor observation | Product outcome |
|---|---|---|
| `running` | `Request was aborted` | `failed.provider_aborted` or `failed.network_interrupted` |
| `cancelling` | `Request was aborted` | `cancelled.graceful` |
| `force_cancelling` | `Request was aborted` | `cancelled.force` |
| `timing_out` | `Request was aborted` | `timed_out` |
| `terminal` | any late SDK event | diagnostic only |

## State Transitions

```text
queued -> starting
starting -> running
running -> cancelling              turn.cancel.requested(graceful)
running -> force_cancelling        turn.cancel.requested(force)
cancelling -> force_cancelling     turn.cancel.requested(force)
running -> timing_out              turn.timeout.requested
cancelling -> cancelled            executor.error/aborted/closed
force_cancelling -> cancelled      executor.error/aborted/closed
timing_out -> timed_out            executor.error/aborted/closed
running -> completed               executor.result
running -> interrupted             tool_use_interrupted diagnostic
running -> failed                  executor.error without cancel/timeout context
any terminal -> terminal           locked; late events are diagnostics only
```

Illegal transitions such as `cancelled -> failed`, `completed -> failed`, or `failed -> cancelled` must not mutate the main outcome.

## Architecture

### ConversationRouter

Keeps queueing and turn orchestration responsibilities. It creates or receives a `TurnLifecycle` for each active turn and passes it through the processing path. It should not directly decide final user-facing error semantics from SDK text.

### SessionManager

Keeps session creation, reuse, interrupt, and close responsibilities. It records cancel intent into the lifecycle before calling `interrupt()` or `close()`. It should not emit final product copy.

### ClaudeSDKSession

Wraps the Claude SDK and emits low-level executor facts. Its query pump can still catch SDK query failures, but the resulting event should preserve diagnostic details and leave product classification to the outcome normalizer.

### TurnLifecycleManager

Owns lifecycle creation, state transition validation, cancel/timeout intent recording, terminal outcome locking, and diagnostic append behavior. It is the single place that answers whether a turn is cancelling, force cancelling, timing out, or terminal.

### TurnOutcomeNormalizer

Owns the decision matrix that maps lifecycle state plus executor event into `TurnOutcome`. It is intentionally separate from UI copy rendering and from SDK adapter code.

### Timeline Projection

Maps product outcomes into existing timeline items and phase events. It does not parse raw SDK diagnostics.

## UI Behavior

The Agent timeline should render product outcomes with the existing shadcn/Radix vocabulary and token classes.

| Product outcome | Main timeline treatment | Main copy |
|---|---|---|
| `completed` | normal result | existing assistant/result behavior |
| `cancelled` graceful | neutral status row or non-destructive info | `已停止本次执行。` |
| `cancelled` force | neutral status row or non-destructive info | `已强制停止本次执行。` |
| `interrupted` recoverable | non-destructive info | `Agent 在工具调用后中断，发送“继续”可接着执行。` |
| `timed_out` | warning/error depending existing convention | `执行超时，任务尚未完成。` |
| `failed` | destructive alert | product failure message |

Raw diagnostic text such as `Request was aborted` should be available through logs or a diagnostics detail surface, not as the default main timeline message for cancellation outcomes.

## Persistence and Export

Persist the product outcome separately from diagnostic text. A cancelled turn should not be stored only as:

```ts
{ error: "Agent 执行失败。诊断信息：Request was aborted" }
```

It should retain structured state:

```ts
{
  turnOutcome: {
    status: "cancelled",
    mode: "graceful",
    reason: "user_cancelled",
    message: "已停止本次执行。",
    diagnostics: [{
      source: "claude-sdk",
      kind: "aborted",
      message: "Request was aborted"
    }]
  }
}
```

History replay, transcript export, phase rows, and usage analysis should prefer `turnOutcome.status` over legacy error text when present. Legacy conversations can continue to render from their existing error strings.

## Migration Strategy

1. Add `TurnOutcome`, `TurnDiagnostic`, and lifecycle types without changing UI behavior.
2. Create lifecycle records inside the existing turn processing path.
3. Record graceful and force cancel intent before calling `interrupt()` or `close()`.
4. Route SDK query errors and result events through the normalizer.
5. Project normalized outcomes back into the existing `AgentEvent` and phase event shapes.
6. Update renderer timeline rendering to use product outcome metadata when present.
7. Extend persistence/export paths to keep structured outcome data while preserving legacy compatibility.

This is an architectural evolution of the existing graded stop design, not a parallel runtime.

## Testing

Add focused tests at the lifecycle and runtime boundaries:

- Graceful stop followed by SDK `Request was aborted` produces `cancelled`, not `failed`.
- Force stop followed by SDK abort produces force cancellation copy.
- SDK abort without cancel intent remains a failure.
- Timeout intent followed by SDK abort produces `timed_out`.
- Successful result before cancellation termination produces `completed`.
- Terminal outcome cannot be overwritten by a late SDK error.
- Tool-use interrupted diagnostic still produces recoverable interrupted behavior.
- Timeline renders cancellation with a non-destructive treatment.
- Export and history replay use structured outcome status when available.

## Release Note

Implementation should add a pending release note because this changes user-visible Agent behavior:

```text
Agent 手动停止后的结果会按“已停止”展示，不再把底层 SDK 中断误报成执行失败；真实网络或供应商中断仍会按失败提示。
```
