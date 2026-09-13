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
