import type { ConversationEntryV1 } from "../../../runtime/data-repo"
import type { StructuredLogger } from "../../../runtime/service-registry"
import type { ProviderService } from "../../provider"
import { ClaudeSDKSession } from "../claude-sdk-session"
import type { AgentSessionRepository } from "../session-repository"
import {
  SessionManager,
  validateWorkspaceDirectory,
  type AgentConnectorRuntimeContribution,
  type CreateAgentLiveSessionInput,
} from "../session-manager"
import type { PendingPermissionState, RuntimeSessionState } from "../session-lifecycle"
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
  it("passes configured allowed write directories to the SDK and recreates after removal", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn(() => {
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    let allowedWriteDirectories: readonly string[] = ["/tmp"]
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
      getAllowedWriteDirectories: () => allowedWriteDirectories,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      additionalDirectories: ["/private/tmp"],
    }))

    allowedWriteDirectories = []
    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledTimes(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
    expect(createSession).toHaveBeenLastCalledWith(expect.objectContaining({
      additionalDirectories: [],
    }))
  })

  it("rejects unavailable workspace paths before creating live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => new FakeLiveSession())
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
      activePersonaId: null,
      activeAgentName: undefined,
      personaToolPolicyMode: "all",
      personaAllowedToolCount: 0,
      hasPersonaSystemPrompt: false,
      synapseToolRouterEnabled: false,
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

  it("resolves connector contributions from the conversation snapshot", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const resolveConnectorContribution = vi.fn(async (
      _message: AgentMessage,
      conversation: ConversationEntryV1,
    ): Promise<AgentConnectorRuntimeContribution> => {
      if (!conversation.agentConfig?.connectorIds?.includes("figma")) return { mcpServers: {}, plugins: [] }
      return {
        mcpServers: { figma: { type: "http" as const, url: "http://127.0.0.1:3845/mcp" } },
        plugins: [],
      }
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
      resolveConnectorContribution,
    })

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation: { ...baseConversation(), agentConfig: { connectorIds: ["figma"] } },
      message: baseMessage("default"),
    })

    expect(resolveConnectorContribution).toHaveBeenCalledWith(
      expect.objectContaining({ content: "run" }),
      expect.objectContaining({ agentConfig: { connectorIds: ["figma"] } }),
    )
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mcpServers: { figma: { type: "http", url: "http://127.0.0.1:3845/mcp" } },
    }))
  })

  it("keeps connector skills and MCP config on the same resolved snapshot", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const figmaMcpServers = {
      figma: { type: "http" as const, url: "http://127.0.0.1:3845/mcp" },
    }
    const resolveConnectorContribution = vi.fn(async () => ({
      mcpServers: figmaMcpServers,
      plugins: [{ type: "local" as const, path: "/Applications/Synapse/resources/figma-skill" }],
    }))
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
      resolveConnectorContribution,
    })
    const conversation = {
      ...baseConversation(),
      agentConfig: { connectorIds: ["figma"] },
    }

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation,
      message: baseMessage("default"),
    })

    expect(resolveConnectorContribution).toHaveBeenCalledOnce()
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mcpServers: figmaMcpServers,
      expectedMcpServerNames: ["figma"],
      plugins: [{ type: "local", path: "/Applications/Synapse/resources/figma-skill" }],
    }))
  })

  it("continues a legacy conversation when its expected MCP config is missing", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
      resolveConnectorContribution: vi.fn(async () => ({ mcpServers: {}, plugins: [] })),
    })

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation: {
        ...baseConversation(),
        agentConfig: { figmaDesktopMcpEnabled: true, expectedMcpServerNames: ["figma"] },
      },
      message: baseMessage("default"),
    })
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      mcpServers: {},
      expectedMcpServerNames: ["figma"],
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

  it("passes active main-thread persona into new live sessions", async () => {
    const states = new Map<string, RuntimeSessionState>()
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
      createSession,
      sdkPersonaConfig: async () => ({
        activePersonaId: "builtin-zh-en-translator",
        activeAgentName: "synapse-persona__builtin-zh-en-translator",
        providerModel: null,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Translate only.",
        },
        toolPolicy: { mode: "disabled", allowedTools: [] },
        agents: {
          "synapse-persona__builtin-zh-en-translator": {
            description: "Translates between Chinese and English.",
            prompt: "Translate only.",
            tools: [],
            disallowedTools: ["*"],
          },
        },
        definitionsHash: "hash-translator",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agent: "synapse-persona__builtin-zh-en-translator",
      agentDefinitionsHash: "hash-translator",
      systemPrompt: {
        type: "preset",
        preset: "claude_code",
        append: "Translate only.",
      },
      tools: [],
      disallowedTools: ["*"],
      personaToolPolicy: { mode: "disabled", allowedTools: [] },
      agents: {
        "synapse-persona__builtin-zh-en-translator": expect.objectContaining({
          prompt: "Translate only.",
        }),
      },
    }))
    expect(state.mainThreadAgentName).toBe("synapse-persona__builtin-zh-en-translator")
    expect(state.agentDefinitionsHash).toBe("hash-translator")
  })

  it("creates a persona session without requiring a hot-switch API", async () => {
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
      sdkPersonaConfig: async () => ({
        activePersonaId: "builtin-zh-en-translator",
        activeAgentName: "synapse-persona__builtin-zh-en-translator",
        providerModel: null,
        agents: {
          "synapse-persona__builtin-zh-en-translator": {
            description: "Translates between Chinese and English.",
            prompt: "Translate only.",
            disallowedTools: ["Agent"],
          },
        },
        definitionsHash: "hash-translator",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await expect(manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })).resolves.toMatchObject({ created: true })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      agent: "synapse-persona__builtin-zh-en-translator",
    }))
    expect(state.mainThreadAgentName).toBe("synapse-persona__builtin-zh-en-translator")
  })

  it("logs active persona runtime metadata without prompt text", async () => {
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
      sdkPersonaConfig: async () => ({
        activePersonaId: "builtin-zh-en-translator",
        activeAgentName: "synapse-persona__builtin-zh-en-translator",
        providerModel: null,
        systemPrompt: {
          type: "preset",
          preset: "claude_code",
          append: "Secret persona prompt text.",
        },
        toolPolicy: { mode: "disabled", allowedTools: [] },
        agents: {
          "synapse-persona__builtin-zh-en-translator": {
            description: "Translates.",
            prompt: "Secret persona prompt text.",
            tools: [],
            disallowedTools: ["*"],
          },
        },
        definitionsHash: "hash-translator",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(logger.info).toHaveBeenCalledWith("Created agent live session.", expect.objectContaining({
      activePersonaId: "builtin-zh-en-translator",
      activeAgentName: "synapse-persona__builtin-zh-en-translator",
      personaToolPolicyMode: "disabled",
      personaAllowedToolCount: 0,
      hasPersonaSystemPrompt: true,
    }))
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("Secret persona prompt text")
  })

  it("recreates the live session when the active persona changes", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn(() => {
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    let activeAgentName: string | undefined = "synapse-persona__old"
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
      sdkPersonaConfig: async () => ({
        activePersonaId: activeAgentName ? "persona-id" : null,
        activeAgentName,
        providerModel: null,
        agents: {
          "synapse-persona__old": { description: "Old", prompt: "Old" },
          "synapse-persona__new": { description: "New", prompt: "New" },
        },
        definitionsHash: "hash-personas",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })
    activeAgentName = "synapse-persona__new"
    const second = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
    expect(state.mainThreadAgentName).toBe("synapse-persona__new")
  })

  it("recreates without resuming the old SDK session when a persona becomes active", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSessionInputs: CreateAgentLiveSessionInput[] = []
    const createSession = vi.fn((input: CreateAgentLiveSessionInput) => {
      createSessionInputs.push(input)
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    let activeAgentName: string | undefined = undefined
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
      sdkPersonaConfig: async () => ({
        activePersonaId: activeAgentName ? "persona-id" : null,
        activeAgentName,
        providerModel: null,
        agents: {
          "synapse-persona__new": { description: "New", prompt: "New" },
        },
        definitionsHash: "hash-personas",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })
    activeAgentName = "synapse-persona__new"
    const second = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSessionInputs.map((input) => input.sdkSessionId)).toEqual(["sdk-1", undefined])
    expect(createSessionInputs[1]?.agent).toBe("synapse-persona__new")
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
  })

  it("recreates the live session when persona definitions change", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSession = vi.fn(() => {
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    let definitionsHash = "hash-1"
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
      sdkPersonaConfig: async () => ({
        activePersonaId: "builtin-zh-en-translator",
        activeAgentName: "synapse-persona__builtin-zh-en-translator",
        providerModel: null,
        agents: {
          "synapse-persona__builtin-zh-en-translator": {
            description: "Translates.",
            prompt: definitionsHash,
          },
        },
        definitionsHash,
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })
    definitionsHash = "hash-2"
    const second = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
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

  it("injects the catalog context window after resolving the requested model tier", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic/",
          ANTHROPIC_MODEL: "qwen3.7-flash",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "qwen3.7-plus",
        })),
        getProvider: vi.fn(async () => ({ id: "bailian", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
    })

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation: { ...baseConversation(), providerId: "bailian", agentConfig: { modelTier: "sonnet" } },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      model: "qwen3.7-plus",
      env: expect.objectContaining({
        CLAUDE_CODE_MAX_CONTEXT_TOKENS: "1000000",
      }),
      contextWindowConfigurationSource: "catalog",
      modelContext: expect.objectContaining({
        modelId: "qwen3.7-plus",
        contextWindowTokens: 1_000_000,
        maxInputTokens: 991_808,
      }),
    }))
  })

  it("preserves an explicit Provider context window while still attaching the official reference", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic",
          ANTHROPIC_MODEL: "qwen3.7-plus",
          CLAUDE_CODE_MAX_CONTEXT_TOKENS: "200000",
        })),
        getProvider: vi.fn(async () => ({ id: "bailian", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
    })

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation: { ...baseConversation(), providerId: "bailian" },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      env: expect.objectContaining({ CLAUDE_CODE_MAX_CONTEXT_TOKENS: "200000" }),
      contextWindowConfigurationSource: "provider-env",
      modelContext: expect.objectContaining({ contextWindowTokens: 1_000_000 }),
    }))
  })

  it("does not inject a window for unknown models or non-target aggregators", async () => {
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://proxy.example.com/anthropic",
          ANTHROPIC_MODEL: "qwen3.7-plus",
        })),
        getProvider: vi.fn(async () => ({ id: "aggregator", category: "aggregator", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
    })

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation: { ...baseConversation(), providerId: "aggregator" },
      message: baseMessage("default"),
    })

    const created = createSession.mock.calls[0]?.[0]
    expect(created?.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS).toBeUndefined()
    expect(created?.modelContext).toBeUndefined()
    expect(created?.contextWindowConfigurationSource).toBeUndefined()
  })

  it("recreates the SDK session when the effective context configuration changes", async () => {
    const contextConfiguration = { explicitWindow: undefined as string | undefined }
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
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/apps/anthropic",
          ANTHROPIC_MODEL: "qwen3.7-plus",
          ...(contextConfiguration.explicitWindow
            ? { CLAUDE_CODE_MAX_CONTEXT_TOKENS: contextConfiguration.explicitWindow }
            : {}),
        })),
        getProvider: vi.fn(async () => ({ id: "bailian", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const conversation = { ...baseConversation(), providerId: "bailian" }

    const first = await manager.getOrCreateSession({ state, conversation, message: baseMessage("default") })
    contextConfiguration.explicitWindow = "200000"
    const second = await manager.getOrCreateSession({ state, conversation, message: baseMessage("default") })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(createSession).toHaveBeenCalledTimes(2)
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
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

  it("enables the tool router only for snapshotted third-party conversations", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const executeSynapseTool = vi.fn()
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2",
          ANTHROPIC_AUTH_TOKEN: "sk-test",
        })),
        getProvider: vi.fn(async () => ({ id: "bailian", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
      executeSynapseTool,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        providerId: "bailian",
        agentConfig: { experimentalSynapseToolRouterEnabled: true },
      },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      synapseToolRouter: expect.any(Function),
    }))
    expect(state.synapseToolRouterEnabled).toBe(true)
  })

  it("exposes router wrappers while preserving original persona and subagent allowlists", async () => {
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2" })),
        getProvider: vi.fn(async () => ({ id: "bailian", category: "cloud_provider", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
      executeSynapseTool: vi.fn(),
      sdkPersonaConfig: async () => ({
        activePersonaId: "database-reader",
        activeAgentName: "synapse-persona__database-reader",
        providerModel: null,
        toolPolicy: {
          mode: "allowlist",
          allowedTools: ["Read", "mcp__synapse-mcp__app_database_table_list"],
        },
        agents: {
          "synapse-persona__database-reader": {
            description: "Reads database metadata.",
            prompt: "Read database metadata.",
            tools: ["Read", "mcp__synapse-mcp__app_database_table_list"],
            disallowedTools: ["mcp__synapse-mcp__app_database_row_create"],
          },
        },
        definitionsHash: "database-reader-v1",
      }),
    })
    const conversation = {
      ...baseConversation(),
      providerId: "bailian",
      agentConfig: { experimentalSynapseToolRouterEnabled: true },
    }

    await manager.getOrCreateSession({
      state: manager.stateForConversation("conversation-1", baseMessage("default")),
      conversation,
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      tools: [
        "Read",
        "mcp__synapse-tool-router__search",
        "mcp__synapse-tool-router__invoke",
      ],
      agents: {
        "synapse-persona__database-reader": expect.objectContaining({
          tools: [
            "Read",
            "mcp__synapse-tool-router__search",
            "mcp__synapse-tool-router__invoke",
          ],
          disallowedTools: [],
        }),
      },
      routerSubagentToolAccess: {
        "synapse-persona__database-reader": {
          allowedTools: ["Read", "mcp__synapse-mcp__app_database_table_list"],
          disallowedTools: ["mcp__synapse-mcp__app_database_row_create"],
        },
      },
    }))
  })

  it("keeps the router off for old conversations, official endpoints, and official providers", async () => {
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => new FakeLiveSession())
    const executeSynapseTool = vi.fn()
    const baseDeps = {
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      states: new Map<string, RuntimeSessionState>(),
      pendingPermissions: new Map<string, PendingPermissionState>(),
      createSession,
      executeSynapseTool,
    }
    const oldManager = new SessionManager({
      ...baseDeps,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_BASE_URL: "https://dashscope.aliyuncs.com/api/v2" })),
        getProvider: vi.fn(),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
    })
    await oldManager.getOrCreateSession({
      state: oldManager.stateForConversation("old", baseMessage("default")),
      conversation: { ...baseConversation(), id: "old" },
      message: baseMessage("default"),
    })

    const officialManager = new SessionManager({
      ...baseDeps,
      states: new Map(),
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_BASE_URL: "https://api.anthropic.com" })),
        getProvider: vi.fn(),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
    })
    await officialManager.getOrCreateSession({
      state: officialManager.stateForConversation("official", baseMessage("default")),
      conversation: {
        ...baseConversation(),
        id: "official",
        agentConfig: { experimentalSynapseToolRouterEnabled: true },
      },
      message: baseMessage("default"),
    })

    const officialProviderManager = new SessionManager({
      ...baseDeps,
      states: new Map(),
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_BASE_URL: "https://proxy.example.com/anthropic" })),
        getProvider: vi.fn(async () => ({ id: "anthropic", category: "official", settingsConfig: {} })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
    })
    await officialProviderManager.getOrCreateSession({
      state: officialProviderManager.stateForConversation("official-provider", baseMessage("default")),
      conversation: {
        ...baseConversation(),
        id: "official-provider",
        agentConfig: { experimentalSynapseToolRouterEnabled: true },
      },
      message: baseMessage("default"),
    })

    expect(createSession.mock.calls.map(([input]) => input.synapseToolRouter)).toEqual([
      undefined,
      undefined,
      undefined,
    ])
  })

  it("recomputes the effective router mode when a conversation changes endpoint", async () => {
    let baseUrl = "https://dashscope.aliyuncs.com/api/v2"
    const sessions = [new FakeLiveSession(), new FakeLiveSession()]
    const createSession = vi.fn((_input: CreateAgentLiveSessionInput) => sessions.shift() ?? new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_BASE_URL: baseUrl })),
        getProvider: vi.fn(),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states: new Map(),
      pendingPermissions: new Map(),
      createSession,
      executeSynapseTool: vi.fn(),
    })
    const conversation = {
      ...baseConversation(),
      agentConfig: { experimentalSynapseToolRouterEnabled: true },
    }
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({ state, conversation, message: baseMessage("default") })
    baseUrl = "https://api.anthropic.com"
    await manager.getOrCreateSession({ state, conversation, message: baseMessage("default") })

    expect(createSession).toHaveBeenCalledTimes(2)
    expect(createSession.mock.calls.map(([input]) => Boolean(input.synapseToolRouter))).toEqual([true, false])
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

  it("grants new external attachment directories to an existing live session", async () => {
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

    const reused = await manager.getOrCreateSession({
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
    })

    expect(reused.created).toBe(false)
    expect(reused.liveSession.grantAdditionalDirectories).toHaveBeenCalledWith([
      "/Users/liyang/Desktop",
    ])
    expect(state.additionalDirectories).toEqual(["/Users/liyang/Desktop"])
    expect(createSession).toHaveBeenCalledOnce()

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: {
        ...baseMessage("default"),
        attachments: [
          {
            kind: "path",
            path: "/Users/liyang/Desktop/reports/nested.pdf",
            entryType: "file",
          },
          {
            kind: "path",
            path: "/tmp/project/inside.md",
            entryType: "file",
          },
        ],
      },
    })
    expect(reused.liveSession.grantAdditionalDirectories).toHaveBeenCalledOnce()
  })

  it("does not update attachment directory state when dynamic authorization fails", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const liveSession = new FakeLiveSession()
    liveSession.grantAdditionalDirectories.mockRejectedValueOnce(new Error("SDK update failed"))
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
      createSession: vi.fn(() => liveSession),
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
    })).rejects.toThrow("当前会话未能授权新的附件目录，请重试")
    expect(state.additionalDirectories).toEqual([])
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

  it("uses the conversation model when the active persona has no provider model", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({
          ANTHROPIC_MODEL: "provider-default",
          ANTHROPIC_DEFAULT_SONNET_MODEL: "provider-sonnet",
        })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      sdkPersonaConfig: async () => ({
        activePersonaId: "persona-1",
        activeAgentName: "synapse-persona__persona-1",
        providerModel: null,
        agents: {
          "synapse-persona__persona-1": { description: "Persona", prompt: "Persona" },
        },
        definitionsHash: "hash-persona",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        providerId: "qwen",
        agentConfig: { modelTier: "sonnet", activeMainThreadPersonaId: "persona-1" },
      },
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "qwen",
      model: "provider-sonnet",
    }))
  })

  it("uses the active persona provider model instead of the conversation model", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const buildEnv = vi.fn(async (providerId: string) => (
      providerId === "deepseek"
        ? { ANTHROPIC_MODEL: "deepseek-chat" }
        : { ANTHROPIC_MODEL: "qwen-max", ANTHROPIC_DEFAULT_SONNET_MODEL: "qwen-plus" }
    ))
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv,
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      sdkPersonaConfig: async () => ({
        activePersonaId: "persona-deepseek",
        activeAgentName: "synapse-persona__persona-deepseek",
        providerModel: { providerId: "deepseek", modelTier: "default" },
        agents: {
          "synapse-persona__persona-deepseek": { description: "Persona", prompt: "Persona" },
        },
        definitionsHash: "hash-persona",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        providerId: "qwen",
        agentConfig: { modelTier: "sonnet", activeMainThreadPersonaId: "persona-deepseek" },
      },
      message: baseMessage("default"),
    })

    expect(buildEnv).toHaveBeenCalledWith("deepseek", expect.any(Object))
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "deepseek",
      model: "deepseek-chat",
    }))
    expect((state as RuntimeSessionState & { effectiveModel?: string }).effectiveModel).toBe("deepseek-chat")
  })

  it("rejects an unavailable persona model tier instead of using the provider default model", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const createSession = vi.fn(() => new FakeLiveSession())
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_MODEL: "deepseek-chat" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      sdkPersonaConfig: async () => ({
        activePersonaId: "persona-deepseek",
        activeAgentName: "synapse-persona__persona-deepseek",
        providerModel: { providerId: "deepseek", modelTier: "sonnet" },
        agents: {
          "synapse-persona__persona-deepseek": { description: "Persona", prompt: "Persona" },
        },
        definitionsHash: "hash-persona",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await expect(manager.getOrCreateSession({
      state,
      conversation: {
        ...baseConversation(),
        providerId: "qwen",
        agentConfig: { modelTier: "opus", activeMainThreadPersonaId: "persona-deepseek" },
      },
      message: baseMessage("default"),
    })).rejects.toThrow("智能体指定的模型不可用")

    expect(createSession).not.toHaveBeenCalled()
  })

  it("allows a persona to use the local Claude Code default without an explicit model", async () => {
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
      sdkPersonaConfig: async () => ({
        activePersonaId: "persona-local",
        activeAgentName: "synapse-persona__persona-local",
        providerModel: { providerId: "local-claude-code", modelTier: "default" },
        agents: {
          "synapse-persona__persona-local": { description: "Persona", prompt: "Persona" },
        },
        definitionsHash: "hash-persona-local",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      providerId: "local-claude-code",
      model: undefined,
    }))
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

  it("persists a pending AskUserQuestion cancellation before closing session state", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const pendingPermissions = new Map<string, PendingPermissionState>()
    const conversation = baseConversation()
    const resolveUserQuestion = vi.fn(async () => conversation)
    const onConversationUpdated = vi.fn()
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: { resolveUserQuestion } as unknown as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions,
      now: () => new Date("2026-07-15T12:00:00.000Z"),
      onConversationUpdated,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const pending = {
      requestId: "question-1",
      projectId: "project-1",
      sessionKey: "session-1",
      conversationId: "conversation-1",
      toolName: "AskUserQuestion",
      createdAt: "2026-07-15T11:59:00.000Z",
      stateKey: "conversation-1",
      liveSession: new FakeLiveSession(),
      resolve: vi.fn(),
    } satisfies PendingPermissionState
    state.pending = pending
    pendingPermissions.set(pending.requestId, pending)

    await manager.closeState("conversation-1")

    expect(resolveUserQuestion).toHaveBeenCalledWith("conversation-1", "question-1", {
      status: "cancelled",
      resolvedAt: "2026-07-15T12:00:00.000Z",
    })
    expect(onConversationUpdated).toHaveBeenCalledWith(conversation)
    expect(pending.resolve).toHaveBeenCalledOnce()
    expect(pendingPermissions.has("question-1")).toBe(false)
    expect(states.has("conversation-1")).toBe(false)
  })

  it("logs cancellation persistence failures and still closes the session state", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const pendingPermissions = new Map<string, PendingPermissionState>()
    const logger = structuredLogger()
    const onConversationUpdated = vi.fn()
    const rawError = "database rejected secret question text"
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {
        resolveUserQuestion: vi.fn(async () => { throw new Error(rawError) }),
      } as unknown as AgentSessionRepository,
      providerService: {
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions,
      logger,
      onConversationUpdated,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const pending = {
      requestId: "question-1",
      projectId: "project-1",
      sessionKey: "session-1",
      conversationId: "conversation-1",
      toolName: "AskUserQuestion",
      createdAt: "2026-07-15T11:59:00.000Z",
      stateKey: "conversation-1",
      liveSession: new FakeLiveSession(),
      resolve: vi.fn(),
    } satisfies PendingPermissionState
    state.pending = pending
    pendingPermissions.set(pending.requestId, pending)

    await expect(manager.closeState("conversation-1")).resolves.toBeUndefined()

    expect(pending.resolve).toHaveBeenCalledOnce()
    expect(onConversationUpdated).not.toHaveBeenCalled()
    expect(states.has("conversation-1")).toBe(false)
    expect(logger.warn).toHaveBeenCalledWith("Agent user question resolution persistence failed.", {
      boundary: "agent-runtime.user-question-resolution",
      projectId: "project-1",
      conversationId: "conversation-1",
      requestId: "question-1",
      status: "cancelled",
      errorName: "Error",
      errorLength: rawError.length,
    })
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("secret question text")
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

  it("recreates an alive SDK session when the active persona provider changes", async () => {
    const states = new Map<string, RuntimeSessionState>()
    const sessions: FakeLiveSession[] = []
    const createSessionInputs: CreateAgentLiveSessionInput[] = []
    const createSession = vi.fn((input: CreateAgentLiveSessionInput) => {
      createSessionInputs.push(input)
      const session = new FakeLiveSession()
      sessions.push(session)
      return session
    })
    const buildEnv = vi.fn(async (providerId: string) => (
      providerId === "deepseek"
        ? { ANTHROPIC_MODEL: "deepseek-chat" }
        : { ANTHROPIC_MODEL: "qwen-max" }
    ))
    let providerId = "qwen"
    const manager = new SessionManager({
      projectId: "project-1",
      workDir: "/tmp/project",
      repository: {} as AgentSessionRepository,
      providerService: {
        buildEnv,
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
      sdkPersonaConfig: async () => ({
        activePersonaId: "persona",
        activeAgentName: "synapse-persona__persona",
        providerModel: { providerId, modelTier: "default" },
        agents: {
          "synapse-persona__persona": { description: "Persona", prompt: "Persona" },
        },
        definitionsHash: "hash-persona",
      }),
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))

    const first = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), agentConfig: { activeMainThreadPersonaId: "persona" } },
      message: baseMessage("default"),
    })
    providerId = "deepseek"
    const second = await manager.getOrCreateSession({
      state,
      conversation: { ...baseConversation(), agentConfig: { activeMainThreadPersonaId: "persona" } },
      message: baseMessage("default"),
    })

    expect(first.created).toBe(true)
    expect(second.created).toBe(true)
    expect(second.liveSession).not.toBe(first.liveSession)
    expect(createSessionInputs.map((input) => input.providerId)).toEqual(["qwen", "deepseek"])
    expect(createSessionInputs.map((input) => input.model)).toEqual(["qwen-max", "deepseek-chat"])
    expect(createSessionInputs.map((input) => input.sdkSessionId)).toEqual(["sdk-1", undefined])
    expect(sessions[0]?.close).toHaveBeenCalledOnce()
  })

  it("reuses the main session across attachment path turns and later plain turns", async () => {
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
        buildEnv: vi.fn(async () => ({ ANTHROPIC_API_KEY: "sk-test" })),
        getActiveProvider: vi.fn(),
      } as unknown as ProviderService,
      states,
      pendingPermissions: new Map(),
      createSession,
    })
    const state = manager.stateForConversation("conversation-1", baseMessage("default"))
    const attachmentMessage = (turnId: string): AgentMessage => ({
      ...baseMessage("default"),
      attachmentTurnId: turnId,
      attachments: [{
        kind: "path",
        path: `/tmp/agent-attachments/${turnId}/attachment_1/original.png`,
        entryType: "image",
        name: "image.png",
      }],
      runtimeAttachmentDirectories: [`/tmp/agent-attachments/${turnId}`],
    })

    const first = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: attachmentMessage("turn_1"),
    })
    const reused = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: attachmentMessage("turn_1"),
    })
    const secondTurn = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: attachmentMessage("turn_2"),
    })
    const plainTurn = await manager.getOrCreateSession({
      state,
      conversation: baseConversation(),
      message: baseMessage("default"),
    })

    expect([first.created, reused.created, secondTurn.created, plainTurn.created])
      .toEqual([true, false, false, false])
    expect(createSessionInputs).toHaveLength(1)
    expect(createSessionInputs[0]?.additionalDirectories).toEqual([
      "/tmp/agent-attachments/turn_1",
    ])
    expect(sessions[0]?.grantAdditionalDirectories).toHaveBeenCalledWith([
      "/tmp/agent-attachments/turn_2",
    ])
    expect(sessions[0]?.close).not.toHaveBeenCalled()
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
  readonly grantAdditionalDirectories = vi.fn(async (_directories: readonly string[]) => {})
  mainThreadAgentName: string | undefined
  protected closed = false
  private closeError: Error | undefined

  constructor(options: {
    readonly cancelError?: Error
  } = {}) {
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
    this.closed = true
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
