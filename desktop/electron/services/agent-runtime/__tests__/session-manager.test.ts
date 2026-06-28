import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type { ProviderService } from "../../provider"
import { ClaudeSDKSession } from "../claude-sdk-session"
import type { AgentSessionRepository } from "../session-repository"
import { SessionManager, validateWorkspaceDirectory, type CreateAgentLiveSessionInput } from "../session-manager"
import type { RuntimeSessionState } from "../session-lifecycle"
import type {
  AgentEvent,
  AgentLiveSession,
  AgentMessage,
  AgentPermissionDecision,
} from "../types"
import { describe, expect, it, vi } from "vitest"

vi.mock("../claude-sdk-session", () => ({
  DEFAULT_CLAUDE_SDK_MAX_TURNS: 200,
  ClaudeSDKSession: vi.fn(function MockClaudeSDKSession() {
    return {
      agentType: "claude-sdk",
      close: vi.fn(),
      send: vi.fn(),
      respondPermission: vi.fn(),
      nextEvent: vi.fn(),
      currentSessionId: vi.fn(() => "sdk-1"),
      alive: vi.fn(() => true),
    }
  }),
}))

describe("SessionManager", () => {
  it("rejects unavailable workspace paths before creating live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const validateWorkspacePath = vi.fn(async () => {
      throw new Error("项目路径不存在或不可访问：/missing-workspace。请在设置中修改项目路径后重试。")
    })
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/missing-workspace",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      validateWorkspacePath,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await expect(manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })).rejects.toThrow("项目路径不存在或不可访问")

    expect(validateWorkspacePath).toHaveBeenCalledWith("/missing-workspace")
    expect(createSession).not.toHaveBeenCalled()
  })

  it("reports missing filesystem workspaces with a user-actionable error", async () => {
    await expect(validateWorkspaceDirectory("/tmp/synapse-missing-workspace-for-test"))
      .rejects.toThrow("请在设置中修改项目路径后重试")
  })

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

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
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

    const sessionHandle = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message,
    })

    expect(sessionHandle.created).toBe(true)
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

  it("passes project SDK plugins into new live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
      sdkPlugins: () => [{
        type: "local",
        path: "/Applications/Synapse/resources/example-plugin",
      }],
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      plugins: [{
        type: "local",
        path: "/Applications/Synapse/resources/example-plugin",
      }],
    }))
  })

  it("passes project SDK agents into new live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
      sdkAgents: () => ({
        "synapse-example-worker": {
          description: "Processes assigned project tasks.",
          prompt: "Only process assigned tasks.",
          tools: ["Read", "Write"],
        },
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agents: {
        "synapse-example-worker": expect.objectContaining({
          description: "Processes assigned project tasks.",
        }),
      },
    }))
  })

  it("passes the default SDK turn cap into new live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      maxTurns: 200,
      providerId: "anthropic",
      mode: "default",
      sdkSessionId: "sdk-1",
    }))
  })

  it("enables WebFetch preflight skip by default for third-party Anthropic-compatible providers", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
        })),
        getProvider: vi.fn(async () => ({
          id: "bailian",
          settingsConfig: {},
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), providerId: "bailian" },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      sdkSettings: {
        skipWebFetchPreflight: true,
      },
    }))
  })

  it("honors explicit WebFetch preflight settings from provider config", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
        })),
        getProvider: vi.fn(async () => ({
          id: "bailian",
          settingsConfig: {
            skipWebFetchPreflight: false,
          },
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), providerId: "bailian" },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      sdkSettings: {
        skipWebFetchPreflight: false,
      },
    }))
  })

  it("recreates an alive SDK session when runtime SDK settings change", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => {
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    let skipWebFetchPreflight = false
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
        })),
        getProvider: vi.fn(async () => ({
          id: "bailian",
          settingsConfig: { skipWebFetchPreflight },
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), providerId: "bailian" },
      message: baseMessage("default"),
    })
    skipWebFetchPreflight = true
    const second = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), providerId: "bailian" },
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls.map(([input]) => input.sdkSettings)).toEqual([
      { skipWebFetchPreflight: false },
      { skipWebFetchPreflight: true },
    ])
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
  })

  it("passes external attachment directories into new live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: {
        ...baseMessage("default"),
        attachments: [
          {
            kind: "path",
            path: "/Users/liyang/Desktop/report.pdf",
            entryType: "file",
          },
          {
            kind: "path",
            path: "/Users/liyang/Downloads/sources",
            entryType: "directory",
          },
          {
            kind: "path",
            path: "/tmp/project/inside.md",
            entryType: "file",
          },
        ],
      },
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      additionalDirectories: [
        "/Users/liyang/Desktop",
        "/Users/liyang/Downloads/sources",
      ],
    }))
  })

  it("blocks existing live sessions when new external attachment directories were not configured", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    await expect(manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: {
        ...baseMessage("default"),
        attachments: [{
          kind: "path",
          path: "/Users/liyang/Desktop/report.pdf",
          entryType: "file",
        }],
      },
    })).rejects.toThrow("当前会话无法访问新附件路径")
    expect(createSession).toHaveBeenCalledOnce()
  })

  it("records the final model after provider env reply target env and model tier resolution", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_MODEL: "provider-default",
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      getReplyTargetEnv: () => ({
        ANTHROPIC_DEFAULT_SONNET_MODEL: "reply-sonnet",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        agentConfig: { modelTier: "sonnet" },
      },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({
        ANTHROPIC_MODEL: "reply-sonnet",
      }),
      model: "reply-sonnet",
    }))
    expect((state as RuntimeSessionState & { effectiveModel?: string }).effectiveModel).toBe("reply-sonnet")
  })

  it("leaves the SDK model unset for local Claude Code default without provider model env", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({})),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        providerId: "local-claude-code",
        agentConfig: { modelTier: "default" },
      },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      env: {},
      model: undefined,
    }))
    expect((state as RuntimeSessionState & { effectiveModel?: string }).effectiveModel).toBeUndefined()
  })

  it("passes project SDK agents into the default Claude SDK live session", async () => {
    vi.mocked(ClaudeSDKSession).mockClear()
    const states = new Map<string, RuntimeSessionState>()
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
      sdkAgents: () => ({
        "synapse-example-worker": {
          description: "Processes assigned project tasks.",
          prompt: "Only process assigned tasks.",
          tools: ["Read", "Write"],
        },
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(ClaudeSDKSession).toHaveBeenCalledWith(expect.objectContaining({
      agents: {
        "synapse-example-worker": expect.objectContaining({
          description: "Processes assigned project tasks.",
        }),
      },
    }))
  })

  it("recreates the SDK session when closing the previous session fails", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const logger = structuredLogger()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => {
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

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(state.liveSession).toBe(second.liveSession)
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

  it("marks the session state as closing while closeCurrentTurn is waiting for SDK close", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const session = new SlowCloseLiveSession()
    state.liveSession = session

    const closing = manager.closeCurrentTurn("conversation-1")
    await session.waitForCloseStart()

    expect(state.closing).toBe(true)

    session.finishClose()
    await closing

    expect(state.closing).toBe(false)
    expect(state.liveSession).toBeUndefined()
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

  it("marks reused live sessions as not created", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(false)
    expect(second.liveSession).toBe(first.liveSession)
    expect(createSession).toHaveBeenCalledOnce()
  })

  it("recreates an alive SDK session when the resolved model changes", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSessionInputs: CreateAgentLiveSessionInput[] = []
    const createSession = vi.fn((input: CreateAgentLiveSessionInput) => {
      createSessionInputs.push(input)
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_MODEL: "provider-default",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "provider-sonnet",
          ANTHROPIC_DEFAULT_OPUS_MODEL: "provider-opus",
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), agentConfig: { modelTier: "sonnet" } },
      message: baseMessage("default"),
    })
    const second = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), agentConfig: { modelTier: "opus" } },
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSessionInputs.map((input) => input.model)).toEqual([
      "provider-sonnet",
      "provider-opus",
    ])
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
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

  async send(): Promise<boolean> {
    return true
  }

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

class SlowCloseLiveSession extends FakeLiveSession {
  private closeStarted: (() => void) | undefined
  private closeStartedPromise = new Promise<void>((resolve) => {
    this.closeStarted = resolve
  })
  private releaseClose: (() => void) | undefined

  override readonly close = vi.fn(async () => {
    this.closeStarted?.()
    await new Promise<void>((resolve) => {
      this.releaseClose = resolve
    })
    await super.close()
  })

  waitForCloseStart(): Promise<void> {
    return this.closeStartedPromise
  }

  finishClose(): void {
    this.releaseClose?.()
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
