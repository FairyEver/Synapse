import { describe, expect, it, vi } from "vitest"
import { InMemoryAuditSink } from "../../../../electron/runtime/security"
import { createAgentConversationCapabilityDispatcher } from "../dispatcher"

describe("Agent conversation capability dispatcher", () => {
  it("authorizes provider discovery before reading and handles failures without exposing details", async () => {
    const listProviders = vi.fn(async () => ({ providers: [], nextOffset: null }))
    const permissionGuard = { check: vi.fn(async () => ({ allowed: false })) }
    const auditSink = new InMemoryAuditSink()
    const dispatcher = createAgentConversationCapabilityDispatcher({
      service: { open: vi.fn() } as never,
      controlService: { listProviders } as never,
      permissionGuard: permissionGuard as never, auditSink,
    })
    const context = { source: "mcp-http" as const, actor: { kind: "user" as const, id: "user" }, clientId: "client" }
    await expect(dispatcher.dispatch("app.agent.provider.list", { query: "private-name" }, context)).resolves.toMatchObject({ ok: false })
    expect(listProviders).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({ action: "agent.conversation.read", resource: "agent:providers" }))
    permissionGuard.check.mockResolvedValue({ allowed: true })
    await expect(dispatcher.dispatch("app.agent.provider.list", { query: "private-name" }, context)).resolves.toMatchObject({ ok: true })
    expect(listProviders).toHaveBeenCalledWith({ query: "private-name", offset: 0, limit: 50 })
    listProviders.mockRejectedValueOnce(new Error("secret-canary"))
    const result = await dispatcher.dispatch("app.agent.provider.list", {}, context)
    expect(result).toMatchObject({ ok: false, code: "operation_failed" })
    expect(JSON.stringify(result)).not.toContain("secret-canary")
    expect(JSON.stringify(auditSink.list())).not.toContain("private-name")
    expect(auditSink.list().map((entry) => entry.outcome)).toEqual(["denied", "allowed", "failed"])
  })

  it("authorizes discovery and creation before accessing groups, auditing only safe result identifiers", async () => {
    const controlService = {
      resolveTarget: vi.fn(),
      listGroups: vi.fn(async () => ({ groups: [], nextOffset: null })),
      create: vi.fn(async () => ({ created: true, projectId: "project-1", conversationRef: "safe-ref", deepLink: "safe-link" })),
    }
    const permissionGuard = { check: vi.fn(async () => ({ allowed: true })) }
    const auditSink = new InMemoryAuditSink()
    const dispatcher = createAgentConversationCapabilityDispatcher({
      service: { open: vi.fn() } as never,
      controlService: controlService as never,
      permissionGuard: permissionGuard as never,
      auditSink,
    })
    const context = { source: "mcp-http" as const, actor: { kind: "user" as const, id: "user" }, clientId: "client" }
    const input = { projectName: "private-group", name: "private-title", idempotencyKey: "8cc55d4d-a4df-4dd8-b5fd-6f1da3385c0f" }
    await expect(dispatcher.dispatch("app.agent.group.list", { query: "private-group" }, context)).resolves.toMatchObject({ ok: true })
    expect(controlService.listGroups).toHaveBeenCalledWith({ query: "private-group", offset: 0, limit: 50 })
    expect(permissionGuard.check).toHaveBeenLastCalledWith(expect.objectContaining({ action: "agent.conversation.read" }))
    await expect(dispatcher.dispatch("app.agent.conversation.create", input, context)).resolves.toMatchObject({ ok: true })
    expect(controlService.create).toHaveBeenCalledWith(input, "client")
    expect(controlService.resolveTarget).not.toHaveBeenCalled()
    expect(permissionGuard.check).toHaveBeenLastCalledWith(expect.objectContaining({ action: "agent.conversation.control" }))
    const audit = JSON.stringify(auditSink.list())
    expect(audit).not.toContain("private-group")
    expect(audit).not.toContain("private-title")
    expect(auditSink.list()[1]?.metadata).toMatchObject({ projectId: "project-1", conversationRef: "safe-ref" })
    permissionGuard.check.mockResolvedValue({ allowed: false })
    await expect(dispatcher.dispatch("app.agent.conversation.create", input, context)).resolves.toMatchObject({ ok: false })
    await expect(dispatcher.dispatch("app.agent.group.list", {}, context)).resolves.toMatchObject({ ok: false })
    expect(controlService.create).toHaveBeenCalledTimes(1)
    expect(controlService.listGroups).toHaveBeenCalledTimes(1)
    expect(auditSink.list().slice(2).map((item) => item.outcome)).toEqual(["denied", "denied"])
  })

  it("returns only the open result", async () => {
    const service = {
      open: vi.fn(async () => ({ opened: true as const })),
    }
    const dispatcher = createAgentConversationCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(
      "app.agent.conversation.open",
      { projectId: "project-1", conversationId: "conversation-1" },
      { source: "mcp-http" },
    )).resolves.toEqual({ ok: true, data: { opened: true }, affected: 1 })
  })

  it("returns the stable not-found error", async () => {
    const { AgentConversationNavigationError } = await import("../../shared/errors")
    const service = {
      open: vi.fn(async () => {
        throw new AgentConversationNavigationError("not_found")
      }),
    }
    const dispatcher = createAgentConversationCapabilityDispatcher({ service: service as never })

    await expect(dispatcher.dispatch(
      "app.agent.conversation.open",
      { projectId: "project-1", conversationId: "missing" },
      { source: "mcp-http" },
    )).resolves.toEqual({ ok: false, code: "not_found", error: "对话不存在或已删除" })
  })

  it("strictly validates, authorizes, audits, and dispatches inspect", async () => {
    const service = { open: vi.fn() }
    const controlService = {
      resolveTarget: vi.fn(async () => ({ projectId: "project-1", conversationId: "conversation-1" })),
      inspect: vi.fn(async () => ({ revision: 2 })),
    }
    const permissionGuard = {
      check: vi.fn(async () => ({ allowed: true as const })),
    }
    const auditSink = new InMemoryAuditSink()
    const dispatcher = createAgentConversationCapabilityDispatcher({
      service: service as never,
      controlService: controlService as never,
      permissionGuard: permissionGuard as never,
      auditSink,
    })
    const context = {
      source: "mcp-http" as const,
      actor: { kind: "user" as const, id: "user-1" },
      clientId: "client-1",
    }

    await expect(dispatcher.dispatch(
      "app.agent.conversation.inspect",
      { projectId: "project-1", conversationId: "conversation-1" },
      context,
    )).resolves.toEqual({ ok: true, data: { revision: 2 }, affected: 1 })
    expect(controlService.inspect).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      limit: 50,
    })
    expect(permissionGuard.check).toHaveBeenCalledWith(expect.objectContaining({
      action: "agent.conversation.read",
      resource: "agent:conversation:conversation-1",
    }))
    expect(auditSink.list()).toHaveLength(1)
    expect(auditSink.list()[0]?.metadata).not.toHaveProperty("content")

    await expect(dispatcher.dispatch(
      "app.agent.conversation.inspect",
      {
        deepLink: "synapse://threads/abcdefghijklmnopqrstuv.abc",
      },
      context,
    )).resolves.toEqual({ ok: true, data: { revision: 2 }, affected: 1 })
    expect(controlService.resolveTarget).toHaveBeenLastCalledWith({
      conversationRef: "agc_abcdefghijklmnopqrstuv.abc",
    })
    expect(controlService.inspect).toHaveBeenLastCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      limit: 50,
    })

    await expect(dispatcher.dispatch(
      "app.agent.conversation.inspect",
      { projectId: "project-1", conversationId: "conversation-1", extra: true },
      context,
    )).resolves.toMatchObject({ ok: false, code: "invalid_input" })
    await expect(dispatcher.dispatch(
      "app.agent.conversation.inspect",
      { deepLink: "synapse://app/agent/open?projectId=project-1&conversationId=%ZZ" },
      context,
    )).resolves.toMatchObject({ ok: false, code: "invalid_link" })
  })
})
