import { describe, expect, it, vi } from "vitest"
import type { ConversationEntryV1, DataNamespace } from "../../../runtime/data-repo"
import type { SynapseAgentClaudeCodeContinuation } from "../../../../src/types/agent"
import type { ProviderService } from "../../provider"
import { AgentRuntimeService } from "../agent-runtime-service"
import type { RuntimeSessionState } from "../session-lifecycle"
import type { AgentLiveSession } from "../types"

vi.mock("../../log-store", () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }) }))

function fixture() {
  const records = new Map<string, ConversationEntryV1>()
  const conversation: ConversationEntryV1 = {
    id: "conversation-1", schemaVersion: 1, projectId: "project-1",
    sessionKey: "local:renderer", platform: "local-renderer", active: true,
    providerId: "deepseek", sdkSessionId: "sdk-1", agentSessionId: "sdk-1",
    agentConfig: { mode: "acceptEdits", modelTier: "sonnet" },
    history: [{ role: "user", content: "Remember the decision", timestamp: "2026-10-10T00:00:00Z" }],
    createdAt: "2026-10-10T00:00:00Z", updatedAt: "2026-10-10T00:00:00Z",
  }
  records.set(conversation.id, conversation)
  let failTransferredSave = false
  let failNextLaunchingSave = false
  const conversations = {
    get: async (id: string) => records.get(id) ?? null,
    upsert: async (value: ConversationEntryV1) => {
      if (failNextLaunchingSave && value.claudeCodeContinuation?.phase === "launching") {
        failNextLaunchingSave = false
        throw new Error("launching save failed")
      }
      if (failTransferredSave && value.claudeCodeContinuation?.phase === "transferred") throw new Error("handoff save failed")
      records.set(value.id, structuredClone(value))
    },
    list: async () => [...records.values()],
  } as unknown as DataNamespace<ConversationEntryV1>
  const makeService = () => new AgentRuntimeService({
    projectId: "project-1", workDir: "/repo", conversations,
    providerService: {
      buildEnv: async () => ({ ANTHROPIC_DEFAULT_SONNET_MODEL: "deepseek-flash" }),
    } as unknown as ProviderService,
  })
  const service = makeService()
  let terminalStatus: "running" | "ended" | "missing" | "unknown" = "missing"
  let selection: SynapseAgentClaudeCodeContinuation | undefined
  const launcher = {
    validate: vi.fn(async (): Promise<void> => undefined),
    terminalStatus: async () => terminalStatus,
    launch: vi.fn(async (input: SynapseAgentClaudeCodeContinuation, created: (id: string) => Promise<void>) => {
      selection = input
      await created("terminal-1")
      terminalStatus = "running"
      return "terminal-1"
    }),
  }
  return { service, records, conversation, launcher, makeService,
    selection: () => selection,
    failTransferredSave: (value: boolean) => { failTransferredSave = value },
    failNextLaunchingSave: () => { failNextLaunchingSave = true },
    endTerminal: () => { terminalStatus = "ended" },
  }
}

describe("Claude Code one-way continuation", () => {
  it("restores UI writes when saving the launch phase fails after a confirmed SDK stop", async () => {
    const f = fixture()
    f.failNextLaunchingSave()
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("launching save failed")
    expect(f.launcher.launch).not.toHaveBeenCalled()
    expect(f.records.get("conversation-1")?.claudeCodeContinuation).toBeUndefined()
    await expect(f.service.setPermissionMode({ conversationId: "conversation-1", mode: "default", actor: { kind: "user", id: "renderer" } })).resolves.toMatchObject({ agentConfig: { mode: "default" } })
  })

  it("continues with a permission mode tightened in the UI after the last turn", async () => {
    const f = fixture()
    const states = (f.service as unknown as { states: Map<string, RuntimeSessionState> }).states
    states.set("conversation-1", {
      key: "conversation-1", queue: [], busy: false, activeTurns: 0, lastActivity: Date.now(), modeOverride: "acceptEdits",
      liveSession: { alive: () => true, setPermissionMode: async () => undefined, close: async () => undefined } as unknown as AgentLiveSession,
    })
    await f.service.setPermissionMode({ conversationId: "conversation-1", mode: "plan", actor: { kind: "user", id: "renderer" } })
    await f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    expect(f.selection()?.permissionMode).toBe("plan")
  })

  it("keeps the recorded model when provider defaults have changed after restart", async () => {
    const f = fixture()
    f.records.set("conversation-1", { ...f.conversation, agentConfig: { ...f.conversation.agentConfig, model: "deepseek-flash[1M]" } })
    await f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    expect(f.selection()?.model).toBe("deepseek-flash[1M]")
  })

  it("continues an ordinary native Claude conversation without selecting a global provider", async () => {
    const f = fixture()
    f.records.set("conversation-1", { ...f.conversation, providerId: "local-claude-code", agentConfig: { mode: "default", model: "claude-sonnet-4-6" } })
    await f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    expect(f.selection()).toMatchObject({ providerId: "local-claude-code", model: "claude-sonnet-4-6", permissionMode: "default", sdkSessionId: "sdk-1" })
  })

  it("retains the SDK handle and durable lock when stopping cannot be confirmed", async () => {
    const f = fixture()
    const liveSession = { close: async () => { throw new Error("SDK stop uncertain") }, currentSessionId: () => "sdk-1" } as unknown as AgentLiveSession
    const states = (f.service as unknown as { states: Map<string, RuntimeSessionState> }).states
    states.set("conversation-1", { key: "conversation-1", queue: [], busy: false, activeTurns: 0, lastActivity: 0, liveSession })
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("SDK stop uncertain")
    expect(states.get("conversation-1")?.liveSession).toBe(liveSession)
    expect(f.records.get("conversation-1")?.claudeCodeContinuation?.phase).toBe("stopping")
    expect(f.launcher.launch).not.toHaveBeenCalled()
    await f.service.reclaimIdleSessions()
    expect(states.get("conversation-1")?.liveSession).toBe(liveSession)
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("SDK stop uncertain")
    expect(f.launcher.launch).not.toHaveBeenCalled()
  })

  it("refuses a busy conversation before changing ownership", async () => {
    const f = fixture()
    const states = (f.service as unknown as { states: Map<string, RuntimeSessionState> }).states
    states.set("conversation-1", { key: "conversation-1", queue: [], busy: true, activeTurns: 1, lastActivity: 0 })
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("等待")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation).toBeUndefined()
  })

  it.each(["queued", "awaiting_permission"])("refuses continuation while the conversation is %s", async (phase) => {
    const f = fixture()
    const states = (f.service as unknown as { states: Map<string, RuntimeSessionState> }).states
    states.set("conversation-1", {
      key: "conversation-1", busy: false, activeTurns: 0, lastActivity: 0,
      queue: phase === "queued" ? [{}] : [],
      permissionAdmissionPending: phase === "awaiting_permission",
    } as RuntimeSessionState)
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("等待")
    expect(f.launcher.launch).not.toHaveBeenCalled()
  })

  it("keeps the UI locked and avoids another launch when a failed PTY has an uncertain status", async () => {
    const f = fixture()
    const launcher = {
      ...f.launcher,
      terminalStatus: async () => "unknown" as const,
      launch: vi.fn(async (_selection: SynapseAgentClaudeCodeContinuation, created: (id: string) => Promise<void>): Promise<string> => {
        await created("uncertain-terminal")
        throw new Error("PTY status uncertain")
      }),
    }
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", launcher)).rejects.toThrow("PTY status uncertain")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation?.terminalSessionId).toBe("uncertain-terminal")
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", launcher)).rejects.toThrow("无法确认")
    expect(launcher.launch).toHaveBeenCalledTimes(1)
  })

  it("preserves read-only ownership when the CLI started but the final save fails", async () => {
    const f = fixture()
    f.failTransferredSave(true)
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("handoff save failed")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation?.terminalSessionId).toBe("terminal-1")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation?.phase).toBe("launching")
    f.failTransferredSave(false)
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).resolves.toBe("terminal-1")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation?.phase).toBe("transferred")
    expect(f.launcher.launch).toHaveBeenCalledTimes(1)
  })

  it("resumes the original context and persists the exact conversation selection", async () => {
    const f = fixture()
    expect(typeof f.service.resumeClaudeCodeConversation).toBe("function")
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).resolves.toBe("terminal-1")
    expect(f.selection()).toMatchObject({
      sdkSessionId: "sdk-1", providerId: "deepseek", model: "deepseek-flash",
      permissionMode: "acceptEdits", cwd: "/repo",
    })
    expect(f.records.get("conversation-1")).toMatchObject({
      claudeCodeContinuation: { phase: "transferred", terminalSessionId: "terminal-1" },
      history: f.conversation.history,
    })
  })

  it("blocks sending, admission, steering and rewind after restart", async () => {
    const f = fixture()
    await f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    const restarted = f.makeService()
    const message = { projectId: "project-1", sessionKey: "local:renderer", platform: "local-renderer", userId: "user", content: "new" }
    await expect(restarted.sendToConversation(message, "conversation-1")).rejects.toThrow("Claude Code")
    await expect(restarted.submitToConversation(message, "conversation-1")).rejects.toThrow("Claude Code")
    await expect(restarted.steer({ conversationId: "conversation-1", expectedTurnId: "turn", clientMessageId: "msg", content: "new", submittedAt: "now" })).rejects.toThrow("Claude Code")
    await expect(restarted.prepareFileCheckpointRewind({ conversationId: "conversation-1", checkpointId: "cp", actor: { kind: "user" } })).rejects.toThrow("Claude Code")
    await expect(restarted.confirmFileCheckpointRewind({ conversationId: "conversation-1", operationId: "op" })).rejects.toThrow("Claude Code")
    await expect(restarted.resetSession("local:renderer", "local-renderer")).rejects.toThrow("Claude Code")
    await expect(restarted.clearCurrentAgentSessionId("local:renderer", "local-renderer")).rejects.toThrow("Claude Code")
    await expect(restarted.setPermissionMode({ conversationId: "conversation-1", mode: "plan", actor: { kind: "user" } })).rejects.toThrow("Claude Code")
    expect(f.records.get("conversation-1")?.sdkSessionId).toBe("sdk-1")
  })

  it("coalesces repeated clicks and reuses a running terminal", async () => {
    const f = fixture()
    const results = await Promise.all([
      f.service.resumeClaudeCodeConversation("conversation-1", f.launcher),
      f.service.resumeClaudeCodeConversation("conversation-1", f.launcher),
    ])
    expect(results).toEqual(["terminal-1", "terminal-1"])
    await f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    expect(f.launcher.launch).toHaveBeenCalledTimes(1)
    f.endTerminal()
    await f.makeService().resumeClaudeCodeConversation("conversation-1", f.launcher)
    expect(f.launcher.launch).toHaveBeenCalledTimes(2)
    expect(f.selection()?.sdkSessionId).toBe("sdk-1")
  })

  it("rejects missing native history before making the UI read-only", async () => {
    const f = fixture()
    f.launcher.validate.mockRejectedValue(new Error("原生会话历史不存在"))
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("历史不存在")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation).toBeUndefined()
  })

  it("releases the initial handoff when no CLI process was started", async () => {
    const f = fixture()
    f.launcher.launch.mockImplementation(async (_selection, created) => {
      await created("failed-terminal")
      throw new Error("PTY failed")
    })
    await expect(f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)).rejects.toThrow("PTY failed")
    expect(f.records.get("conversation-1")?.claudeCodeContinuation).toBeUndefined()
  })

  it("locks out concurrent sends while validating the handoff", async () => {
    const f = fixture()
    let release!: () => void
    f.launcher.validate.mockImplementation(() => new Promise<void>((resolve) => { release = resolve }))
    const handoff = f.service.resumeClaudeCodeConversation("conversation-1", f.launcher)
    await vi.waitFor(() => expect(release).toBeTypeOf("function"))
    await expect(f.service.submitToConversation({ projectId: "project-1", sessionKey: "local:renderer", platform: "local-renderer", userId: "user", content: "race" }, "conversation-1")).rejects.toThrow("Claude Code")
    release()
    await handoff
  })
})
