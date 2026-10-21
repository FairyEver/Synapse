import { describe, expect, it, vi } from "vitest"
import { randomUUID } from "node:crypto"
import type { ConversationEntryV1, DataNamespace } from "../../../runtime/data-repo"
import { GeneratedUiService, createGeneratedUiMetadata } from "../generated-ui-service"
import type { GeneratedUiStateEntry } from "../../../runtime/data-repo/schemas/agent-generated-ui"

function namespace<T extends { id: string }>() {
  const rows = new Map<string, T>()
  return { get: async (id: string) => rows.get(id) ?? null,
    upsert: async (value: T) => { rows.set(value.id, value) },
    list: async (filter?: Partial<T>) => [...rows.values()].filter((row) => Object.entries(filter ?? {}).every(([k, v]) => row[k as keyof T] === v)),
    remove: async (id: string) => { rows.delete(id) },
  } as unknown as DataNamespace<T>
}

async function fixture() {
  const conversations = namespace<ConversationEntryV1>()
  const states = namespace<GeneratedUiStateEntry>()
  const content = '```openui\nroot = Stack([TextContent("Hello")])\n```'
  const metadata = createGeneratedUiMetadata(content, "turn-1")!
  const conversation = { id: "conversation-1", projectId: "project-1", platform: "local-renderer", sessionKey: "local", history: [{ role: "assistant", content, metadata: { generatedUi: metadata } }] } as unknown as ConversationEntryV1
  await conversations.upsert(conversation)
  const service = new GeneratedUiService("project-1", conversations, states)
  const target = { projectId: "project-1", conversationId: conversation.id, blockId: metadata.blocks[0].id }
  return { service, conversations, states, conversation, target }
}

describe("GeneratedUiService", () => {
  it("persists form values independently and rejects stale multi-window writes", async () => {
    const f = await fixture()
    expect(await f.service.get(f.target)).toMatchObject({ revision: 0, state: {} })
    await f.service.save({ ...f.target, expectedRevision: 0, state: { days: "30" } })
    expect(await f.service.get(f.target)).toMatchObject({ revision: 1, state: { days: "30" } })
    await expect(f.service.save({ ...f.target, expectedRevision: 0, state: { days: "7" } })).rejects.toThrow("已更新")
    expect(f.conversation.history[0].content).toContain("TextContent")
  })

  it("deduplicates a submission and passes raw values to the same conversation", async () => {
    const f = await fixture()
    const send = vi.fn(async (_message: { conversationId: string; content: string }) => true)
    const input = { ...f.target, submissionId: randomUUID(), expectedRevision: 0, message: "查询", formState: { days: "30" } }
    const [a, b] = await Promise.all([f.service.submit(input, send), f.service.submit(input, send)])
    expect(a.status).toBe("accepted")
    expect(b).toEqual(a)
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0]?.[0]).toMatchObject({ conversationId: f.target.conversationId, content: expect.stringContaining('"days":"30"') })
  })

  it("does not retry an uncertain admission after restart", async () => {
    const f = await fixture()
    const input = { ...f.target, submissionId: randomUUID(), expectedRevision: 0, message: "提交", formState: {} }
    await expect(f.service.submit(input, async () => { throw new Error("disconnected") })).rejects.toThrow("确认")
    const restarted = new GeneratedUiService("project-1", f.conversations, f.states)
    const send = vi.fn(async () => true)
    expect((await restarted.submit(input, send)).status).toBe("uncertain")
    expect(send).not.toHaveBeenCalled()
  })
  it("keeps the full saved state when the submitted action contains only one named form", async () => {
    const f = await fixture()
    const state = { first: { days: "30" }, second: { name: "saved" }, $period: "month" }
    await f.service.save({ ...f.target, expectedRevision: 0, state })
    await f.service.submit({ ...f.target, expectedRevision: 1, submissionId: randomUUID(), message: "查询", formState: { first: state.first } }, async () => true)
    expect((await f.service.get(f.target)).state).toEqual(state)
  })

  it("rejects foreign projects, altered source, deleted blocks and CLI continuation", async () => {
    const f = await fixture()
    await expect(f.service.get({ ...f.target, projectId: "foreign" })).rejects.toThrow()
    await expect(f.service.get({ ...f.target, blockId: randomUUID() })).rejects.toThrow()
    f.conversation.claudeCodeContinuation = {} as never
    expect((await f.service.get(f.target)).readOnly).toBe(true)
    await expect(f.service.save({ ...f.target, expectedRevision: 0, state: {} })).rejects.toThrow("只读")
    delete f.conversation.claudeCodeContinuation
    f.conversation.history[0].content += "changed"
    f.conversation.history[0].content = f.conversation.history[0].content.replace("Hello", "Changed")
    await expect(f.service.get(f.target)).rejects.toThrow()
  })

  it("cleans state by project and conversation and exports only redacted form state", async () => {
    const f = await fixture()
    await f.service.save({ ...f.target, expectedRevision: 0, state: { apiKey: "fake-secret", days: "30" } })
    expect(JSON.stringify(await f.service.export(f.target.conversationId))).not.toContain("fake-secret")
    await f.service.removeConversation(f.target.conversationId)
    expect((await f.service.get(f.target)).revision).toBe(0)
  })
})
