import { describe, expect, it } from "vitest"

import {
  createTurnLifecycle,
  diagnosticFromAgentError,
  markCancelRequested,
  markTimeoutRequested,
  normalizeExecutorEvent,
  outcomeMessage,
  outcomeToAgentEvent,
} from "../turn-outcome"

describe("turn outcome normalization", () => {
  it.each([true, false, undefined])("preserves execution failure recoverability %s through terminal projection", (recoverable) => {
    const lifecycle = createTurnLifecycle({ turnId: "turn-1", conversationId: "conversation-1" })
    const message = "图片结果超过当前上下文预算，尚未完成处理。"
    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: diagnosticFromAgentError({
        type: "error", errorKind: "execution_failed", message, recoverable,
      }),
    })
    expect(outcome).toMatchObject({ status: "failed", message })
    const projected = outcomeToAgentEvent({ outcome, conversationId: "conversation-1", timestamp: "2026-09-13T00:00:00Z" })
    expect(projected).toMatchObject({ type: "error", errorKind: "execution_failed", message, recoverable: recoverable === true })
    // A late successful result must not erase the saved incomplete outcome.
    expect(normalizeExecutorEvent(lifecycle, { type: "executor.result" })).toBe(outcome)
  })

  it("does not restore recovery after cancellation of a recoverable failure", () => {
    const lifecycle = createTurnLifecycle({ turnId: "turn-1", conversationId: "conversation-1" })
    markCancelRequested(lifecycle, { mode: "graceful", source: "user", now: () => "2026-09-13T00:00:00Z" })
    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: diagnosticFromAgentError({ type: "error", errorKind: "execution_failed", message: "未完整交付", recoverable: true }),
    })
    expect(outcome.status).toBe("cancelled")
    expect(outcomeToAgentEvent({ outcome, conversationId: "conversation-1", timestamp: "2026-09-13T00:00:00Z" })).toMatchObject({
      type: "result", metadata: { cancelled: true },
    })
  })

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

  it("keeps generic SDK error messages without adding failure wrapper copy", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
      now: () => "2026-06-11T00:00:00.000Z",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "error",
        message: "failed",
      },
    })

    expect(outcome).toMatchObject({
      status: "failed",
      reason: "runtime_error",
      message: "failed",
    })
    expect(outcomeMessage(outcome)).toBe("failed")
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

  it("keeps connection interruptions recoverable", () => {
    const lifecycle = createTurnLifecycle({
      turnId: "turn-1",
      conversationId: "conversation-1",
    })

    const outcome = normalizeExecutorEvent(lifecycle, {
      type: "executor.error",
      diagnostic: {
        source: "claude-sdk",
        kind: "connection_interrupted",
        message: "Connection lost mid-response",
      },
    })

    expect(outcome).toMatchObject({
      status: "interrupted",
      reason: "network_interrupted",
      recoverable: true,
      message: "模型连接中断，任务尚未完成。",
    })
  })
})
