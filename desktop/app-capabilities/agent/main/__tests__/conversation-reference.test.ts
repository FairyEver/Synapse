import { describe, expect, it, vi } from "vitest"

import type { ConversationEntryV1, DataNamespace } from "../../../../electron/runtime/data-repo"
import {
  agentConversationReference,
  isValidAgentConversationReference,
  resolveGlobalAgentConversationReference,
  resolveAgentConversationReference,
} from "../conversation-reference"

const conversation: ConversationEntryV1 = {
  id: "agent-runtime:long-repetitive-internal-identifier",
  schemaVersion: 1,
  projectId: "project-1",
  sessionKey: "local:renderer",
  history: [],
  active: true,
  createdAt: "2026-09-13T00:00:00.000Z",
  updatedAt: "2026-09-13T00:00:00.000Z",
}

describe("Agent conversation references", () => {
  it("derives a short stable checksummed reference", () => {
    const first = agentConversationReference(conversation.projectId, conversation.id)
    expect(first).toMatch(/^agc_[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{3}$/)
    expect(agentConversationReference(conversation.projectId, conversation.id)).toBe(first)
    expect(agentConversationReference("other-project", conversation.id)).not.toBe(first)
    expect(isValidAgentConversationReference(first)).toBe(true)
    expect(isValidAgentConversationReference(`${first.slice(0, -1)}A`)).toBe(false)
  })

  it("resolves a reference without exposing the internal id in the link", async () => {
    const namespace = {
      get: vi.fn(async () => null),
      list: vi.fn(async () => [conversation]),
    } as unknown as DataNamespace<ConversationEntryV1>
    const reference = agentConversationReference(conversation.projectId, conversation.id)
    await expect(resolveAgentConversationReference(namespace, conversation.projectId, reference))
      .resolves.toEqual(conversation)
  })

  it("scans bounded summaries before loading the matched conversation", async () => {
    const namespace = {
      get: vi.fn(async (id: string) => id === conversation.id ? conversation : null),
      list: vi.fn(),
      listWindow: vi.fn(async () => [{ value: conversation, arrayLength: 9_000 }]),
    } as unknown as DataNamespace<ConversationEntryV1>
    const reference = agentConversationReference(conversation.projectId, conversation.id)

    await expect(resolveAgentConversationReference(namespace, conversation.projectId, reference))
      .resolves.toEqual(conversation)
    expect(namespace.list).not.toHaveBeenCalled()
    expect(namespace.listWindow).toHaveBeenCalledWith(expect.objectContaining({
      filter: { projectId: conversation.projectId },
      limit: 500,
      arrayTail: "history",
    }))
    expect(namespace.get).toHaveBeenLastCalledWith(conversation.id)
  })

  it("resolves a canonical thread reference without a project identifier", async () => {
    const otherConversation = { ...conversation, id: "other", projectId: "project-2" }
    const namespace = {
      get: vi.fn(async (id: string) => id === conversation.id ? conversation : null),
      list: vi.fn(),
      listWindow: vi.fn(async () => [
        { value: otherConversation, arrayLength: 0 },
        { value: conversation, arrayLength: 9_000 },
      ]),
    } as unknown as DataNamespace<ConversationEntryV1>
    const reference = agentConversationReference(conversation.projectId, conversation.id)

    await expect(resolveGlobalAgentConversationReference(namespace, reference))
      .resolves.toEqual(conversation)
    expect(namespace.listWindow).toHaveBeenCalledWith(expect.not.objectContaining({ filter: expect.anything() }))
    expect(namespace.get).toHaveBeenLastCalledWith(conversation.id)
  })
})
