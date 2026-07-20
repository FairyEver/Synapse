import type { AgentDraftAttachment } from "./attachments"

type PendingMessageTarget = {
  readonly projectId: string
  readonly conversationId: string
  readonly sessionKey: string
}

type PendingMessageStatus = "queued" | "sending" | "failed"

type PendingMessageInput = {
  readonly id: string
  readonly content: string
  readonly attachments?: readonly AgentDraftAttachment[]
  readonly target: PendingMessageTarget
  readonly createdAt: string
}

type PendingMessage = PendingMessageInput & {
  readonly status: PendingMessageStatus
  readonly error?: string
}

const MAX_PENDING_QUEUE_SIZE = 20

function targetKey(target: PendingMessageTarget): string {
  return [target.projectId, target.conversationId, target.sessionKey].join("\0")
}

function enqueuePendingMessage(input: PendingMessageInput): PendingMessage {
  return {
    id: input.id,
    content: input.content,
    attachments: input.attachments,
    target: input.target,
    createdAt: input.createdAt,
    status: "queued",
  }
}

function pendingMessagesForTarget(
  queue: readonly PendingMessage[],
  target: PendingMessageTarget | undefined,
): PendingMessage[] {
  if (!target) return []
  const key = targetKey(target)
  return queue.filter((message) => targetKey(message.target) === key)
}

function firstQueuedMessageForIdleTarget(
  queue: readonly PendingMessage[],
  sendingConversationIds: ReadonlySet<string>,
): PendingMessage | undefined {
  const blockedTargets = new Set<string>()
  for (const message of queue) {
    const key = targetKey(message.target)
    if (blockedTargets.has(key)) continue
    if (sendingConversationIds.has(message.target.conversationId)) {
      blockedTargets.add(key)
      continue
    }
    if (message.status === "queued") return message
    blockedTargets.add(key)
  }
  return undefined
}

function markPendingMessageSending(message: PendingMessage): PendingMessage {
  return {
    ...message,
    status: "sending",
    error: undefined,
  }
}

function markPendingMessageFailed(message: PendingMessage, error: string): PendingMessage {
  return {
    ...message,
    status: "failed",
    error,
  }
}

function replacePendingMessage(
  queue: readonly PendingMessage[],
  replacement: PendingMessage,
): PendingMessage[] {
  return queue.map((message) => message.id === replacement.id ? replacement : message)
}

function removePendingMessage(
  queue: readonly PendingMessage[],
  id: string,
): PendingMessage[] {
  return queue.filter((message) => message.id !== id)
}

export {
  enqueuePendingMessage,
  firstQueuedMessageForIdleTarget,
  markPendingMessageFailed,
  markPendingMessageSending,
  MAX_PENDING_QUEUE_SIZE,
  pendingMessagesForTarget,
  removePendingMessage,
  replacePendingMessage,
  targetKey,
}
export type { PendingMessage, PendingMessageStatus, PendingMessageTarget }
