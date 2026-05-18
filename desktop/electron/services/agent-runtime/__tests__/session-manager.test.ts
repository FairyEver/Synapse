import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type { ProviderService } from "../../provider"
import type { AgentSessionRepository } from "../session-repository"
import { SessionManager, type CreateAgentLiveSessionInput } from "../session-manager"
import type { RuntimeSessionState } from "../session-lifecycle"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"
import { describe, expect, it, vi } from "vitest"

describe("SessionManager", () => {
  it("recreates an alive SDK session when the requested mode changes", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn((input: CreateAgentLiveSessionInput) => {
      const session = new FakeLiveSession()
      sessions.push(session)
      expect(input.providerId).toBe("anthropic")
      return session
    })
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })
    const second = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("bypassPermissions"),
    })

    expect(second).not.toBe(first)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls.map(([input]) => input.mode)).toEqual([
      "default",
      "bypassPermissions",
    ])
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
  })

  it("logs interrupt failures without leaking SDK error text", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const logger = structuredLogger()
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      logger,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    state.providerId = "anthropic"
    state.modeOverride = "default"
    state.liveSession = new FakeLiveSession({
      cancelError: new Error("SDK interrupt failed for secret prompt text"),
    })

    await expect(manager.interrupt("conversation-1")).resolves.toBe(false)

    expect(logger.warn).toHaveBeenCalledWith("Agent session interrupt failed.", {
      boundary: "agent-runtime.live-session.interrupt",
      conversationId: "conversation-1",
      providerId: "anthropic",
      mode: "default",
      sdkSessionId: "sdk-1",
      errorName: "Error",
      errorLength: "SDK interrupt failed for secret prompt text".length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt text")
  })

  it("logs live session creation with SDK resume correlation", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const logger = structuredLogger()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      logger,
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const message = {
      ...baseMessage("default"),
      workspaceKey: "repo-1",
      workspacePath: "/Users/liyang/private/project",
    }

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message,
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      sdkSessionId: "sdk-1",
    }))
    expect(logger.info).toHaveBeenCalledWith("Created agent live session.", {
      boundary: "agent-runtime.live-session.create",
      projectId: "project-1",
      conversationId: "conversation-1",
      providerId: "anthropic",
      mode: "default",
      sessionKey: "session-1",
      platform: "scheduled",
      workspaceKey: "repo-1",
      hasWorkspacePath: true,
      resumePolicy: "resume",
      sdkSessionId: "sdk-1",
    })
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("/Users/liyang")
  })

  it("recreates the SDK session when closing the previous session fails", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const logger = structuredLogger()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn(() => {
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      logger,
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })
    sessions[0]?.setCloseError(new Error("close failed for secret prompt text"))

    const second = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("bypassPermissions"),
    })

    expect(second).not.toBe(first)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(state.liveSession).toBe(second)
    expect(logger.warn).toHaveBeenCalledWith("Agent live session close failed.", {
      boundary: "agent-runtime.live-session.close",
      conversationId: "conversation-1",
      providerId: "anthropic",
      mode: "default",
      sdkSessionId: "sdk-1",
      errorName: "Error",
      errorLength: "close failed for secret prompt text".length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret prompt text")
  })

  it("logs idle session reclaim with SDK session correlation", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const logger = structuredLogger()
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      logger,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    state.providerId = "anthropic"
    state.modeOverride = "default"
    state.liveSession = new FakeLiveSession()
    state.lastActivity = Date.now() - 11 * 60 * 1000

    await manager.closeIdleSessions()

    expect(logger.info).toHaveBeenCalledWith("Reclaimed idle agent session.", {
      boundary: "agent-runtime.live-session.idle-reclaim",
      conversationId: "conversation-1",
      providerId: "anthropic",
      mode: "default",
      sdkSessionId: "sdk-1",
    })
  })
})

function baseConversation(): ConversationEntryV1 {
  return {
    id: "conversation-1",
    schemaVersion: 1,
    projectId: "project-1",
    sessionKey: "session-1",
    providerId: "anthropic",
    sdkSessionId: "sdk-1",
    resumePolicy: "resume",
    history: [],
    active: true,
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
  }
}

function baseMessage(modeOverride: string): AgentMessage {
  return {
    projectId: "project-1",
    sessionKey: "session-1",
    platform: "scheduled",
    userId: "task-runner",
    content: "run",
    modeOverride,
  }
}

class FakeLiveSession implements AgentLiveSession {
  readonly agentType = "claude-sdk"
  readonly close = vi.fn(async () => {
    if (this.closeError) throw this.closeError
    this.closed = true
  })
  readonly cancelCurrentTurn?: () => Promise<boolean>
  private closed = false
  private closeError: Error | undefined

  constructor(options: { readonly cancelError?: Error } = {}) {
    if (options.cancelError) {
      this.cancelCurrentTurn = vi.fn(async () => {
        throw options.cancelError
      })
    }
  }

  async send(): Promise<void> {}

  async respondPermission(
    _requestId: string,
    _decision: AgentPermissionDecision,
  ): Promise<void> {}

  async nextEvent(): Promise<AgentEvent | null> {
    return null
  }

  currentSessionId(): string | undefined {
    return "sdk-1"
  }

  alive(): boolean {
    return !this.closed
  }

  setCloseError(error: Error): void {
    this.closeError = error
  }
}

function structuredLogger(): StructuredLogger & {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
  const logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  }
  logger.child.mockReturnValue(logger)
  return logger
}
