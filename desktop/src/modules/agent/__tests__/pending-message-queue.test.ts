import { describe, expect, it } from "vitest"

import {
  enqueuePendingMessage,
  firstQueuedMessageForIdleTarget,
  markPendingMessageFailed,
  markPendingMessageSending,
  pendingMessagesForTarget,
  removePendingMessage,
  targetKey,
} from "../pending-message-queue"
import { createPathAttachment } from "../attachments"

const targetA = {
  projectId: "project-a",
  conversationId: "conversation-a",
  sessionKey: "local:renderer",
}

const targetB = {
  projectId: "project-b",
  conversationId: "conversation-b",
  sessionKey: "local:renderer",
}

describe("pending message queue", () => {
  it("keeps messages scoped to the session where they were queued", () => {
    const queue = [
      enqueuePendingMessage({
        id: "pending-1",
        content: "A",
        target: targetA,
        createdAt: "2026-05-13T10:00:00.000Z",
      }),
      enqueuePendingMessage({
        id: "pending-2",
        content: "B",
        target: targetB,
        createdAt: "2026-05-13T10:00:01.000Z",
      }),
    ]

    expect(pendingMessagesForTarget(queue, targetA).map((message) => message.content)).toEqual(["A"])
    expect(pendingMessagesForTarget(queue, targetB).map((message) => message.content)).toEqual(["B"])
  })

  it("selects only the first queued message for an idle target", () => {
    const queue = [
      enqueuePendingMessage({
        id: "pending-1",
        content: "A",
        target: targetA,
        createdAt: "2026-05-13T10:00:00.000Z",
      }),
      enqueuePendingMessage({
        id: "pending-2",
        content: "B",
        target: targetA,
        createdAt: "2026-05-13T10:00:01.000Z",
      }),
    ]

    expect(firstQueuedMessageForIdleTarget(queue, new Set())?.id).toBe("pending-1")
    expect(firstQueuedMessageForIdleTarget(queue, new Set([targetA.conversationId]))).toBeUndefined()
  })

  it("does not overtake a sending or failed message in the same target queue", () => {
    const queue = [
      markPendingMessageSending(enqueuePendingMessage({
        id: "pending-1",
        content: "A",
        target: targetA,
        createdAt: "2026-05-13T10:00:00.000Z",
      })),
      enqueuePendingMessage({
        id: "pending-2",
        content: "B",
        target: targetA,
        createdAt: "2026-05-13T10:00:01.000Z",
      }),
      enqueuePendingMessage({
        id: "pending-3",
        content: "C",
        target: targetB,
        createdAt: "2026-05-13T10:00:02.000Z",
      }),
    ]

    expect(firstQueuedMessageForIdleTarget(queue, new Set())?.id).toBe("pending-3")

    const failedQueue = [
      markPendingMessageFailed(queue[0]!, "发送失败"),
      queue[1]!,
      queue[2]!,
    ]

    expect(firstQueuedMessageForIdleTarget(failedQueue, new Set())?.id).toBe("pending-3")
  })

  it("removes queued messages by id", () => {
    const queue = [
      enqueuePendingMessage({
        id: "pending-1",
        content: "A",
        target: targetA,
        createdAt: "2026-05-13T10:00:00.000Z",
      }),
      enqueuePendingMessage({
        id: "pending-2",
        content: "B",
        target: targetA,
        createdAt: "2026-05-13T10:00:01.000Z",
      }),
    ]

    expect(removePendingMessage(queue, "pending-1").map((message) => message.id)).toEqual(["pending-2"])
  })

  it("uses project, conversation, and session key for queue identity", () => {
    expect(targetKey(targetA)).toBe("project-a\u0000conversation-a\u0000local:renderer")
  })

  it("preserves attachments through enqueue and retry transitions", () => {
    const attachments = [
      createPathAttachment({
        id: "path-1",
        path: "/Users/liyang/Desktop/brief.md",
        entryType: "file",
      }),
    ]

    const queued = enqueuePendingMessage({
      id: "pending-1",
      content: "",
      attachments,
      target: targetA,
      createdAt: "2026-05-13T10:00:00.000Z",
    })
    const failed = markPendingMessageFailed(queued, "发送失败")
    const retried = enqueuePendingMessage(failed)

    expect(queued.attachments).toBe(attachments)
    expect(failed.attachments).toBe(attachments)
    expect(retried.attachments).toBe(attachments)
  })

  it("preserves the selected persona snapshot through enqueue and retry transitions", () => {
    const queued = enqueuePendingMessage({
      id: "pending-1",
      content: "Translate this",
      target: targetA,
      createdAt: "2026-05-13T10:00:00.000Z",
      mainThreadPersonaId: "builtin-zh-en-translator",
      mainThreadPersonaName: "中英翻译",
    })
    const failed = markPendingMessageFailed(queued, "发送失败")
    const retried = enqueuePendingMessage(failed)

    expect(queued.mainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(queued.mainThreadPersonaName).toBe("中英翻译")
    expect(failed.mainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(failed.mainThreadPersonaName).toBe("中英翻译")
    expect(retried.mainThreadPersonaId).toBe("builtin-zh-en-translator")
    expect(retried.mainThreadPersonaName).toBe("中英翻译")
  })
})
