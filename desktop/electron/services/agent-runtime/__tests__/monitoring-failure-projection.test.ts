import { expect, it } from "vitest"
import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import { agentEventSchema, timelineItemSchema } from "../../../modules/agent/ipc-shared"
import { historyRecordToTimelineItem } from "../../../../src/lib/agent-timeline"
import { createTurnLifecycle, diagnosticFromAgentError, normalizeExecutorEvent, outcomeToAgentEvent } from "../turn-outcome"

it("keeps a recoverable output failure through IPC and renderer history replay", () => {
  const message = "非文本结果未完整交付，任务尚未完成。"
  const outcome = normalizeExecutorEvent(createTurnLifecycle({ turnId: "turn-1", conversationId: "conversation-1" }), {
    type: "executor.error",
    diagnostic: diagnosticFromAgentError({ type: "error", errorKind: "execution_failed", recoverable: true, message }),
  })
  const event = outcomeToAgentEvent({ outcome, conversationId: "conversation-1", timestamp: "2026-09-13T00:00:01Z" })
  expect(agentEventSchema.parse(event)).toMatchObject({ type: "error", recoverable: true,
    turnOutcome: { status: "failed", recoverable: true } })
  const conversation: ConversationEntryV1 = {
    id: "conversation-1", schemaVersion: 1, projectId: "project-1", sessionKey: "local:fixture",
    platform: "local-renderer", active: true, createdAt: "2026-09-13T00:00:00Z", updatedAt: "2026-09-13T00:00:01Z",
    history: [
      { role: "user", content: "检查图片", timestamp: "2026-09-13T00:00:00Z" },
      { role: "system", content: message, timestamp: "2026-09-13T00:00:01Z",
        metadata: { agentEventType: "error", errorKind: "execution_failed", recoverable: true, turnOutcome: outcome } },
    ],
  }
  const replay = historyRecordToTimelineItem(conversation.id, conversation.history[1]!, 1)
  expect(timelineItemSchema.parse(replay)).toMatchObject({ kind: "error", recoverable: true,
    turnOutcome: { status: "failed", recoverable: true } })
})

it.each(["partial", "coverage-complete"] as const)("preserves the same %s assessment in live IPC and stored timeline projections", (status) => {
  const taskCompletion = { status, revision: 3, declaredUnits: 2, coveredUnits: status === "partial" ? 1 : 2,
    processedUnits: status === "partial" ? 1 : 2, conflictingFindings: 0, semanticCorrectness: "unverified" as const }
  const failed = status === "partial"
  const event = failed
    ? { type: "error", message: "材料未完成", recoverable: true, taskCompletion }
    : { type: "result", content: "覆盖完成，内容判断尚未独立验证", done: true, metadata: { taskCompletion } }
  expect(agentEventSchema.parse(event)).toMatchObject(failed ? { taskCompletion } : { metadata: { taskCompletion } })
  const replay = historyRecordToTimelineItem("c", { role: failed ? "system" : "assistant", content: "任务评估", timestamp: "2026-09-13T00:00:01Z",
    metadata: { agentEventType: event.type, taskCompletion, recoverable: failed } }, 1)
  expect(timelineItemSchema.parse(replay)).toMatchObject(failed ? { kind: "error", taskCompletion } : { kind: "result", metadata: { taskCompletion } })
})
