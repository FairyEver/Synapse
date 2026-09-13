import { describe, expect, it, vi } from "vitest"
import type { ConversationEntryV1, DataRepository } from "../../../../electron/runtime/data-repo"
import type { WindowManager } from "../../../../electron/runtime/window"
import { AgentConversationNavigationError } from "../../shared/errors"
import { AgentConversationNavigationService } from "../service"
import { agentConversationReference } from "../conversation-reference"

function createService(entries: ConversationEntryV1[]) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]))
  const windowManager = {
    open: vi.fn(),
    broadcast: vi.fn(() => 1),
  } as unknown as WindowManager
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
  }
  const dataRepository = {
    namespace: vi.fn(() => ({
      get: vi.fn(async (id: string) => byId.get(id) ?? null),
      list: vi.fn(async (filter?: Partial<ConversationEntryV1>) => [...byId.values()].filter(
        (entry) => !filter?.projectId || entry.projectId === filter.projectId,
      )),
    })),
  } as unknown as DataRepository
  return {
    service: new AgentConversationNavigationService({ dataRepository, windowManager, logger }),
    windowManager,
    logger,
  }
}

function conversation(
  id: string,
  platform?: string,
  projectId = "project-1",
): ConversationEntryV1 {
  return {
    id,
    schemaVersion: 1,
    projectId,
    sessionKey: `session:${id}`,
    platform,
    history: [],
    active: true,
    createdAt: "2026-09-12T00:00:00.000Z",
    updatedAt: "2026-09-12T00:00:00.000Z",
  }
}

describe("AgentConversationNavigationService", () => {
  it.each([
    [undefined, "user"],
    ["local", "user"],
    ["local-renderer", "user"],
    ["workflow", "workflow"],
    ["automation", "automation"],
    ["scheduled", "scheduled"],
    ["webhook", "webhook"],
    ["relay", "relay"],
    ["unknown-source", "bridge"],
  ] as const)("maps platform %s to source filter %s", async (platform, sourceFilter) => {
    const entry = conversation("conversation-1", platform)
    const { service, windowManager } = createService([entry])

    await expect(service.open({
      projectId: entry.projectId,
      conversationId: entry.id,
    })).resolves.toEqual({ opened: true })

    expect(windowManager.open).toHaveBeenCalledWith("main")
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:open_agent_session:operation",
      {
        requestId: 1,
        projectId: entry.projectId,
        conversationId: entry.id,
        sessionKey: entry.sessionKey,
        sourceFilter,
      },
      expect.any(Function),
    )
  })

  it("rejects missing, project-mismatched, and constrained conversations", async () => {
    const entry = conversation("conversation-1", "workflow")
    const { service, windowManager } = createService([entry])

    await expect(service.open({
      projectId: "other-project",
      conversationId: entry.id,
    })).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "not_found" })
    await expect(service.open({
      projectId: entry.projectId,
      conversationId: "missing",
    })).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "not_found" })
    await expect(service.open({
      projectId: entry.projectId,
      conversationId: entry.id,
    }, {
      sessionKey: "wrong-session",
      platform: "workflow",
    })).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "not_found" })

    expect(windowManager.open).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it("opens canonical thread links across projects while rejecting a damaged checksum", async () => {
    const entry = conversation("agent-runtime:long-internal-id", "local-renderer", "project-2")
    const reference = agentConversationReference(entry.projectId, entry.id)
    const deepLink = `synapse://threads/${reference.slice("agc_".length)}`
    const { service, windowManager } = createService([entry])

    await expect(service.open({ deepLink })).resolves.toEqual({ opened: true })
    expect(windowManager.broadcast).toHaveBeenCalledWith(
      "synapse:app:open_agent_session:operation",
      expect.objectContaining({ projectId: entry.projectId, conversationId: entry.id }),
      expect.any(Function),
    )
    await expect(service.open({
      projectId: entry.projectId,
      conversationRef: `${reference.slice(0, -1)}A`,
    })).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "invalid_locator" })
  })

  it("rejects the removed project query deep-link route", async () => {
    const entry = conversation("agent-runtime:long-internal-id", "local-renderer")
    const reference = agentConversationReference(entry.projectId, entry.id)
    const deepLink = `synapse://app/agent/open?projectId=${entry.projectId}&conversationId=${reference}`
    const { service, windowManager } = createService([entry])

    await expect(service.open({ deepLink }))
      .rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "invalid_link" })
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it("resolves Markdown-escaped links without weakening checksum checks", async () => {
    const entry = conversation("escaped-link", "local-renderer")
    const reference = agentConversationReference(entry.projectId, entry.id)
    const threadId = reference.slice(4)
    const escaped = threadId.replace(/[_.-]/g, "\\$&")
    const { service, windowManager } = createService([entry])
    await expect(service.open({ deepLink: `synapse://threads/${escaped}` })).resolves.toEqual({ opened: true })
    expect(windowManager.broadcast).toHaveBeenCalledWith(expect.any(String),
      expect.objectContaining({ projectId: entry.projectId, conversationId: entry.id }), expect.any(Function))
    const corrupted = `${threadId.slice(0, -3)}${threadId.endsWith("AAA") ? "BBB" : "AAA"}`.replace(/[_.-]/g, "\\$&")
    await expect(service.open({ deepLink: `synapse://threads/${corrupted}` }))
      .rejects.toMatchObject({ code: "invalid_locator" })
    expect(windowManager.broadcast).toHaveBeenCalledTimes(1)
  })

  it("rejects empty and additional public input fields", async () => {
    const entry = conversation("conversation-1", "local")
    const { service, windowManager } = createService([entry])

    await expect(service.open({
      projectId: "",
      conversationId: entry.id,
    })).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "invalid_input" })
    await expect(service.open({
      projectId: entry.projectId,
      conversationId: entry.id,
      extra: true,
    } as never)).rejects.toMatchObject<Partial<AgentConversationNavigationError>>({ code: "invalid_input" })

    expect(windowManager.open).not.toHaveBeenCalled()
    expect(windowManager.broadcast).not.toHaveBeenCalled()
  })

  it("keeps only the latest request and clears it only for a matching acknowledgement", async () => {
    const first = conversation("conversation-1", "local")
    const second = conversation("conversation-2", "workflow")
    const { service } = createService([first, second])

    await service.open({ projectId: first.projectId, conversationId: first.id })
    await service.open({ projectId: second.projectId, conversationId: second.id })

    expect(service.getPendingOpenRequest()).toMatchObject({
      requestId: 2,
      conversationId: second.id,
    })
    service.acknowledgeOpenRequest(1)
    expect(service.getPendingOpenRequest()).not.toBeNull()
    service.acknowledgeOpenRequest(2)
    expect(service.getPendingOpenRequest()).toBeNull()
  })
})
