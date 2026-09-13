import { beforeEach, describe, expect, it, vi } from "vitest"
import { createLocalAgentConversation } from "../conversation-creation"
import { configStore } from "../../../services/config-store"
import { assertKnowledgeBaseStorageMigrationInactive, resolveProjectAgent } from "../ipc-shared"

vi.mock("../../../services/config-store", () => ({ configStore: { load: vi.fn() } }))
vi.mock("../ipc-shared", () => ({
  DEFAULT_LOCAL_SESSION_KEY: "local:renderer",
  LOCAL_RENDERER_PLATFORM: "local-renderer",
  assertKnowledgeBaseStorageMigrationInactive: vi.fn(),
  resolveProjectAgent: vi.fn(),
}))

const localProjectId = "builtin:default-agent-workspace"
const preferred = { id: "preferred", name: "Preferred", model: "model-one" }
const active = { id: "active", name: "Active", active: true, sonnetModel: "model-two" }

function harness(providers = [preferred, active]) {
  const createSession = vi.fn(async (input) => ({ id: "new-conversation", ...input }))
  const listAllProviders = vi.fn(async () => providers)
  const resolve = vi.fn(() => ({ listAllProviders })) as never
  vi.mocked(configStore.load).mockResolvedValue({
    global: { projects: [{ id: "project-1", name: "Project One", path: "/project" }] },
    agent: { defaultProviderModel: { providerId: "preferred", modelTier: "default" }, defaultPermissionMode: "plan" },
  } as never)
  vi.mocked(resolveProjectAgent).mockResolvedValue({ agent: { createSession } } as never)
  return { createSession, listAllProviders, resolve }
}

describe("MCP local conversation creation", () => {
  beforeEach(() => vi.resetAllMocks())

  it("uses the configured default model, permission mode and local identity through the runtime", async () => {
    const { resolve, createSession } = harness()
    await createLocalAgentConversation(resolve, { projectId: localProjectId, name: "New" })
    expect(resolveProjectAgent).toHaveBeenCalledWith(resolve, localProjectId)
    expect(createSession).toHaveBeenCalledExactlyOnceWith({
      sessionKey: "local:renderer", platform: "local-renderer", agentType: "claude-code",
      providerId: "preferred", modelTier: "default", mode: "plan", name: "New", personaId: null,
    })
  })

  it("uses an explicit model instead of the default", async () => {
    const { resolve, createSession } = harness()
    await createLocalAgentConversation(resolve, { projectId: localProjectId, providerId: "active", modelTier: "sonnet" })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ providerId: "active", modelTier: "sonnet" }))
  })

  it.each([
    { providerId: "missing", modelTier: "default" as const },
    { providerId: "active", modelTier: "opus" as const },
    { providerId: "archived", modelTier: "default" as const },
  ])("rejects an unavailable explicit model without persisting or falling back: %s", async (selection) => {
    const { resolve, createSession } = harness([preferred, active, { ...preferred, id: "archived", archived: true } as typeof preferred])
    await expect(createLocalAgentConversation(resolve, { projectId: localProjectId, ...selection }))
      .rejects.toMatchObject({ code: "model_unavailable" })
    expect(createSession).not.toHaveBeenCalled()
    expect(resolveProjectAgent).not.toHaveBeenCalled()
  })

  it("accepts the local Claude Code default without an explicit model name", async () => {
    const { resolve, createSession } = harness([{ id: "local-claude-code", name: "Local" } as typeof preferred])
    await createLocalAgentConversation(resolve, { projectId: localProjectId, providerId: "local-claude-code", modelTier: "default" })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({ providerId: "local-claude-code", modelTier: "default" }))
  })

  it("falls back to the active provider like UI quick create and generates a default name", async () => {
    const { resolve, createSession } = harness([active])
    await createLocalAgentConversation(resolve, { projectId: "project-1" })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "active", modelTier: "sonnet", name: expect.stringMatching(/^新对话 \d{2}:\d{2}$/),
    }))
  })

  it("does not persist a conversation when model selection is unavailable", async () => {
    const { resolve, createSession } = harness([])
    await expect(createLocalAgentConversation(resolve, { projectId: localProjectId })).rejects.toMatchObject({ code: "model_unavailable" })
    expect(resolveProjectAgent).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it("rechecks project membership and blocks a group deleted since discovery", async () => {
    const { resolve, createSession } = harness()
    await expect(createLocalAgentConversation(resolve, { projectId: "deleted" })).rejects.toMatchObject({ code: "group_not_found" })
    expect(resolveProjectAgent).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it("keeps knowledge base migration checks before creating or resolving a runtime", async () => {
    const { resolve, createSession } = harness()
    vi.mocked(assertKnowledgeBaseStorageMigrationInactive).mockImplementationOnce(() => { throw new Error("Migration active") })
    await expect(createLocalAgentConversation(resolve, { projectId: "project-1" })).rejects.toThrow("Migration active")
    expect(resolveProjectAgent).not.toHaveBeenCalled()
    expect(createSession).not.toHaveBeenCalled()
  })

  it("reports unavailable workspaces and propagates persistence failures without claiming creation", async () => {
    const { resolve, createSession } = harness()
    vi.mocked(resolveProjectAgent).mockRejectedValueOnce(new Error("Workspace unavailable"))
    await expect(createLocalAgentConversation(resolve, { projectId: "project-1" })).rejects.toMatchObject({ code: "project_unavailable" })
    expect(createSession).not.toHaveBeenCalled()
    createSession.mockRejectedValueOnce(new Error("Storage unavailable"))
    await expect(createLocalAgentConversation(resolve, { projectId: "project-1" })).rejects.toThrow("Storage unavailable")
  })
})
