import type { AgentErrorEvent, AgentEvent, AgentResultEvent } from "./types"

export type AgentTurnOutcomeStatus =
  | "completed"
  | "cancelled"
  | "failed"
  | "timed_out"
  | "interrupted"

export type AgentTurnDiagnosticKind =
  | "aborted"
  | "closed"
  | "connection_interrupted"
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
    readonly reason: "network_interrupted" | "tool_use_interrupted"
    readonly recoverable: true
    readonly message: string
    readonly diagnostics?: readonly AgentTurnDiagnostic[]
  }

export interface TurnLifecycle {
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
): AgentTurnOutcome {
  const diagnostic = "diagnostic" in event ? event.diagnostic : undefined
  if (diagnostic) lifecycle.diagnostics.push(diagnostic)

  if (lifecycle.terminalOutcome) {
    return lifecycle.terminalOutcome
  }

  const outcome = outcomeForEvent(lifecycle, event)
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
): AgentTurnOutcome {
  if (event.type === "executor.result") return { status: "completed" }

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
      reason: timeoutReason(lifecycle.timeoutIntent.source),
      message: "执行超时，任务尚未完成。",
    }
  }

  const diagnostic = "diagnostic" in event ? event.diagnostic : undefined
  if (isToolUseInterrupted(diagnostic)) {
    return {
      status: "interrupted",
      reason: "tool_use_interrupted",
      recoverable: true,
      message: "Agent 在工具调用后中断，发送“继续”可接着执行。",
    }
  }

  if (diagnostic?.kind === "connection_interrupted") {
    return {
      status: "interrupted",
      reason: "network_interrupted",
      recoverable: true,
      message: "模型连接中断，任务尚未完成。",
    }
  }

  return {
    status: "failed",
    reason: failureReason(diagnostic),
    message: failedMessage(diagnostic),
  }
}

function attachDiagnostics(
  outcome: AgentTurnOutcome,
  diagnostics: readonly AgentTurnDiagnostic[],
): AgentTurnOutcome {
  if (outcome.status === "completed" || diagnostics.length === 0) return outcome
  return { ...outcome, diagnostics: [...diagnostics] } as AgentTurnOutcome
}

function isToolUseInterrupted(diagnostic: AgentTurnDiagnostic | undefined): boolean {
  const message = diagnostic?.message ?? ""
  return diagnostic?.kind === "tool_use_interrupted"
    || (/\bstop_reason=tool_use\b/.test(message) && /\bresult_type=user\b/.test(message))
}

function timeoutReason(source: "runtime" | "scheduler" | "relay"): "runtime_timeout" | "scheduler_timeout" | "relay_timeout" {
  if (source === "scheduler") return "scheduler_timeout"
  if (source === "relay") return "relay_timeout"
  return "runtime_timeout"
}

function failureReason(diagnostic: AgentTurnDiagnostic | undefined): AgentTurnFailureReason {
  if (diagnostic?.kind === "aborted") return "provider_aborted"
  return "runtime_error"
}

function failedMessage(diagnostic: AgentTurnDiagnostic | undefined): string {
  if (diagnostic?.kind === "aborted") return "请求中断，任务未完成。"
  return diagnostic?.message ?? "Agent 执行失败。"
}

export function diagnosticFromAgentError(event: AgentErrorEvent): AgentTurnDiagnostic {
  const message = unwrapAgentDiagnosticMessage(event.message)
  return {
    source: "claude-sdk",
    kind: event.errorKind === "connection_interrupted"
      ? "connection_interrupted"
      : isToolUseInterruptedMessage(message)
        ? "tool_use_interrupted"
        : /Request was aborted/i.test(message) ? "aborted" : "error",
    message,
  }
}

function unwrapAgentDiagnosticMessage(message: string): string {
  const marker = "诊断信息："
  const index = message.indexOf(marker)
  return index >= 0 ? message.slice(index + marker.length).trim() : message
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
      errorKind: input.outcome.reason === "network_interrupted"
        ? "connection_interrupted"
        : "tool_use_interrupted",
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

function isToolUseInterruptedMessage(message: string): boolean {
  return /\bstop_reason=tool_use\b/.test(message) && /\bresult_type=user\b/.test(message)
}
