import { createHash, timingSafeEqual } from "node:crypto"

import type { ConversationEntryV1, DataNamespace } from "../../../electron/runtime/data-repo"

const REFERENCE_PREFIX = "agc_"
const REFERENCE_PAYLOAD_BYTES = 16
const REFERENCE_CHECKSUM_BYTES = 2
const REFERENCE_PATTERN = /^agc_([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{3})$/

export function agentConversationReference(
  projectId: string,
  conversationId: string,
): string {
  const payload = digestBytes(
    `synapse-agent-conversation-reference\0${projectId}\0${conversationId}`,
    REFERENCE_PAYLOAD_BYTES,
  )
  return `${REFERENCE_PREFIX}${payload}.${referenceChecksum(payload)}`
}

export function isValidAgentConversationReference(value: string): boolean {
  const match = REFERENCE_PATTERN.exec(value)
  if (!match) return false
  const actual = Buffer.from(match[2] as string, "base64url")
  const expected = Buffer.from(referenceChecksum(match[1] as string), "base64url")
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export async function resolveAgentConversationReference(
  conversations: DataNamespace<ConversationEntryV1>,
  projectId: string,
  locator: string,
): Promise<ConversationEntryV1 | null> {
  const direct = await conversations.get(locator)
  if (direct?.projectId === projectId && direct.id === locator) return direct
  if (!isValidAgentConversationReference(locator)) return null

  return scanAgentConversationReference(conversations, locator, projectId)
}

export async function resolveGlobalAgentConversationReference(
  conversations: DataNamespace<ConversationEntryV1>,
  locator: string,
): Promise<ConversationEntryV1 | null> {
  if (!isValidAgentConversationReference(locator)) return null
  return scanAgentConversationReference(conversations, locator)
}

async function scanAgentConversationReference(
  conversations: DataNamespace<ConversationEntryV1>,
  locator: string,
  projectId?: string,
): Promise<ConversationEntryV1 | null> {
  if (!conversations.listWindow) {
    const candidates = await conversations.list(
      projectId === undefined ? undefined : { projectId } as Partial<ConversationEntryV1>,
    )
    const matching = candidates.filter(
      (conversation) => agentConversationReference(conversation.projectId, conversation.id) === locator,
    )
    return matching.length === 1 ? matching[0] as ConversationEntryV1 : null
  }

  const pageSize = 500
  let matchingId: string | null = null
  for (let offset = 0; ; offset += pageSize) {
    const page = await conversations.listWindow({
      ...(projectId === undefined ? {} : { filter: { projectId } }),
      orderBy: "createdAt",
      order: "asc",
      limit: pageSize,
      offset,
      arrayTail: "history",
    })
    for (const { value } of page) {
      if (agentConversationReference(value.projectId, value.id) !== locator) continue
      if (matchingId !== null && matchingId !== value.id) return null
      matchingId = value.id
    }
    if (page.length < pageSize) {
      return matchingId === null ? null : conversations.get(matchingId)
    }
  }
}

export function looksLikeAgentConversationReference(value: string): boolean {
  return value.startsWith(REFERENCE_PREFIX)
}

function referenceChecksum(payload: string): string {
  return digestBytes(`synapse-agent-conversation-reference-checksum\0${payload}`, REFERENCE_CHECKSUM_BYTES)
}

function digestBytes(value: string, length: number): string {
  return createHash("sha256").update(value, "utf8").digest().subarray(0, length).toString("base64url")
}
