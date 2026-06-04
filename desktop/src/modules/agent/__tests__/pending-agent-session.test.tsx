/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode, Ref } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseProjectConfig } from "@/types/config"
import type { SynapseAgentSessionSummary } from "@/types/agent"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "@/lib/default-agent-workspace"
import { AgentModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => {
  const toast = Object.assign(vi.fn(), { error: vi.fn() })
  return {
    chat: null as unknown,
    useAgentChat: vi.fn(),
    forcePin: vi.fn(),
    stickState: {
      isPinned: true,
      hasUnread: false,
    },
    scrollToBottom: vi.fn(),
    viewportRef: vi.fn(),
    composerProps: null as {
      showJumpToBottom?: boolean
      showIdleJumpToBottom?: boolean
      onJumpToBottom?: () => void
      knowledgeBaseActions?: readonly unknown[]
      onKnowledgeBaseCommand?: (commandText: string) => void | Promise<void>
    } | null,
    timelineProps: null as {
      onOpenReference?: (reference: string) => void
      viewportRef?: Ref<HTMLDivElement>
    } | null,
    sidebarProps: null as {
      projects?: Array<{ id: string; name: string; path: string }>
      sourceFilter?: string
      onCreateSession?: (projectId: string, selection: { providerId: string; modelTier: string }) => void | Promise<void>
      onSourceFilterChange?: (sourceFilter: string) => void
    } | null,
    configProjects: [{ id: "project-1", name: "Project One", path: "/repo" }] as SynapseProjectConfig[],
    activeRepository: { uuid: "project-1", name: "Project One", localPath: "/repo" },
    bridgeAvailable: true,
    bridge: {
      agent: {
        getTimeline: vi.fn(),
        openReference: vi.fn(),
      },
    },
    toast,
    rendererLogger: {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    },
  }
})

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.rendererLogger,
}))

vi.mock("@/lib/electron-bridge", () => ({
  getSynapseBridge: () => mocks.bridgeAvailable ? mocks.bridge : undefined,
  requireSynapseBridge: () => mocks.bridge,
}))

vi.mock("sonner", () => ({
  toast: mocks.toast,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: mocks.configProjects,
      },
    },
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => mocks.activeRepository,
}))

vi.mock("@/lib/runtime-platform", () => ({
  getRendererPlatform: () => "darwin",
}))

vi.mock("../hooks/use-agent-chat", () => ({
  useAgentChat: mocks.useAgentChat,
}))

vi.mock("../hooks/use-stick-to-bottom", () => ({
  latestTimelineContentSignal: () => "",
  useStickToBottom: () => ({
    forcePin: mocks.forcePin,
    viewportRef: mocks.viewportRef,
    isPinned: mocks.stickState.isPinned,
    hasUnread: mocks.stickState.hasUnread,
    scrollToBottom: mocks.scrollToBottom,
  }),
}))

vi.mock("@/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({ children, sidebar }: { children: ReactNode; sidebar?: ReactNode }) => (
    <main>
      {sidebar}
      {children}
    </main>
  ),
}))

vi.mock("../components/agent-session-sidebar", () => ({
  AgentSessionSidebar: (props: {
    projects?: Array<{ id: string; name: string; path: string }>
    sourceFilter?: string
    onCreateSession?: (projectId: string, selection: { providerId: string; modelTier: string }) => void | Promise<void>
    onSourceFilterChange?: (sourceFilter: string) => void
  }) => {
    mocks.sidebarProps = props
    return <aside />
  },
}))

vi.mock("../components/agent-timeline", () => ({
  AgentTimeline: (props: { onOpenReference?: (reference: string) => void; viewportRef?: Ref<HTMLDivElement> }) => {
    mocks.timelineProps = props
    return <section ref={props.viewportRef} />
  },
}))

vi.mock("../components/agent-composer", () => ({
  AgentComposer: (props: {
    showJumpToBottom?: boolean
    showIdleJumpToBottom?: boolean
    onJumpToBottom?: () => void
    knowledgeBaseActions?: readonly unknown[]
    onKnowledgeBaseCommand?: (commandText: string) => void | Promise<void>
  }) => {
    mocks.composerProps = props
    return <form />
  },
}))

const targetSession: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "conversation-1",
  sessionKey: "local:renderer",
  active: true,
  historyCount: 0,
  createdAt: "2026-05-13T00:00:00.000Z",
  updatedAt: "2026-05-13T00:00:00.000Z",
}

let roots: Root[] = []

beforeEach(() => {
  mocks.useAgentChat.mockImplementation(() => mocks.chat)
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
  mocks.chat = null
  mocks.stickState = {
    isPinned: true,
    hasUnread: false,
  }
  mocks.scrollToBottom.mockClear()
  mocks.viewportRef.mockClear()
  mocks.composerProps = null
  mocks.timelineProps = null
  mocks.sidebarProps = null
  mocks.configProjects = [{ id: "project-1", name: "Project One", path: "/repo" }]
  mocks.activeRepository = { uuid: "project-1", name: "Project One", localPath: "/repo" }
  mocks.bridgeAvailable = true
  mocks.useAgentChat.mockImplementation(() => mocks.chat)
})

describe("AgentModule pending prompt sessions", () => {
  it("does not include the active repository in the session sidebar when it is not a project", async () => {
    mocks.configProjects = [{ id: "project-1", name: "Project One", path: "/repo" }]
    mocks.activeRepository = {
      uuid: "repo-1",
      name: "Repository One",
      localPath: "/content-repo",
    }
    mocks.chat = createChatState()

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.sidebarProps?.projects).toEqual([
      DEFAULT_AGENT_WORKSPACE_PROJECT,
      { id: "project-1", name: "Project One", path: "/repo" },
    ])
  })

  it("refreshes missing pending sessions before selecting and sending the prompt", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(true)
    const onPendingAgentSessionConsumed = vi.fn()
    mocks.chat = createChatState({ refresh, selectSession, sendMessage })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            prompt: "Run this prompt",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(selectSession).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onPendingAgentSessionConsumed).not.toHaveBeenCalled()

    mocks.chat = createChatState({
      sessions: [targetSession],
      refresh,
      selectSession,
      sendMessage,
    })

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            prompt: "Run this prompt",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    expect(selectSession).toHaveBeenCalledWith(targetSession)
    expect(sendMessage).toHaveBeenCalledWith("Run this prompt")
    expect(onPendingAgentSessionConsumed).toHaveBeenCalledTimes(1)
  })

  it("logs pending session refresh failures with sanitized conversation context", async () => {
    const refreshError = new Error("secret pending prompt text")
    const refresh = vi.fn().mockRejectedValue(refreshError)
    mocks.chat = createChatState({ refresh })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            prompt: "Run this prompt",
          }}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(mocks.rendererLogger.error).toHaveBeenCalledWith(
      "Agent pending session refresh failed.",
      {
        boundary: "renderer.agent.pending-session-refresh",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        errorName: "Error",
        errorLength: refreshError.message.length,
      },
    )
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("secret pending prompt text")
  })

  it("shows a stale pending conversation message after refresh cannot find the target", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const onPendingAgentSessionConsumed = vi.fn()
    const pendingAgentSession = {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "workflow:project-1:123",
      sourceFilter: "workflow" as const,
    }
    mocks.chat = createChatState({ refresh, selectSession })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={pendingAgentSession}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={pendingAgentSession}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
      await Promise.resolve()
    })

    mocks.chat = createChatState({ refresh, selectSession })
    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={pendingAgentSession}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(selectSession).not.toHaveBeenCalled()
    expect(mocks.toast.error).toHaveBeenCalledWith("对话不存在或已删除")
    expect(onPendingAgentSessionConsumed).toHaveBeenCalledTimes(1)
  })

  it("does not render an active session when no conversation is selected", async () => {
    mocks.chat = createChatState({
      sessions: [targetSession],
      timeline: [{
        id: "stale-message",
        kind: "message",
        role: "assistant",
        content: "stale content",
        timestamp: "2026-05-14T00:00:00.000Z",
      }],
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.timelineProps).toBeNull()
    expect(container.textContent).toContain("请创建新的会话")
  })

  it("renders selected session title without the agent cli badge", async () => {
    mocks.chat = createChatState({
      sessions: [{
        ...targetSession,
        agentType: "claude-code",
        name: "deepseek",
      }],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(container.textContent).toBe("deepseek")
  })

  it("does not render a selected session excluded by the active source filter", async () => {
    mocks.chat = createChatState({
      sessions: [{
        ...targetSession,
        platform: "workflow",
        name: "Workflow Run",
      }],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "stale-message",
        kind: "message",
        role: "assistant",
        content: "stale content",
        timestamp: "2026-05-14T00:00:00.000Z",
      }],
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.sidebarProps?.sourceFilter).toBe("user")
    expect(mocks.timelineProps).toBeNull()
    expect(container.textContent).toContain("请创建新的会话")
    expect(container.textContent).not.toContain("Workflow Run")
    expect(container.textContent).not.toContain("stale content")
  })

  it("remounts the selected user timeline after returning from an empty source filter", async () => {
    mocks.chat = createChatState({
      sessions: [{
        ...targetSession,
        platform: "local-renderer",
        name: "User Chat",
      }],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "Latest answer",
        timestamp: "2026-06-02T00:00:00.000Z",
      }],
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.timelineProps?.viewportRef).toBe(mocks.viewportRef)
    expect(mocks.viewportRef.mock.calls.at(-1)?.[0]).toBeInstanceOf(HTMLElement)

    await act(async () => {
      mocks.sidebarProps?.onSourceFilterChange?.("workflow")
    })

    expect(container.textContent).toContain("请创建新的会话")
    expect(mocks.viewportRef.mock.calls.at(-1)?.[0]).toBeNull()

    await act(async () => {
      mocks.sidebarProps?.onSourceFilterChange?.("user")
    })

    expect(container.textContent).not.toContain("请创建新的会话")
    expect(mocks.timelineProps?.viewportRef).toBe(mocks.viewportRef)
    expect(mocks.viewportRef.mock.calls.at(-1)?.[0]).toBeInstanceOf(HTMLElement)
  })

  it("switches source filter before selecting a pending workflow session", async () => {
    const workflowSession: SynapseAgentSessionSummary = {
      ...targetSession,
      sessionKey: "workflow:project-1:123",
      platform: "workflow",
      name: "Workflow Run",
    }
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const onPendingAgentSessionConsumed = vi.fn()
    mocks.chat = createChatState({
      sessions: [workflowSession],
      selectSession,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            sessionKey: "workflow:project-1:123",
            sourceFilter: "workflow",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })

    expect(mocks.sidebarProps?.sourceFilter).toBe("workflow")
    expect(selectSession).toHaveBeenCalledWith(workflowSession)
    expect(onPendingAgentSessionConsumed).toHaveBeenCalledTimes(1)
  })

  it("switches back to user conversations when creating a local session from another source filter", async () => {
    const createSession = vi.fn().mockResolvedValue(undefined)
    mocks.chat = createChatState({
      createSession,
      sessions: [{
        ...targetSession,
        platform: "scheduled",
        name: "Scheduled Run",
      }],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    await act(async () => {
      mocks.sidebarProps?.onSourceFilterChange?.("scheduled")
    })

    expect(mocks.sidebarProps?.sourceFilter).toBe("scheduled")

    await act(async () => {
      await mocks.sidebarProps?.onCreateSession?.("project-1", {
        providerId: "provider-1",
        modelTier: "opus",
      })
    })

    expect(createSession).toHaveBeenCalledWith("project-1", "provider-1", undefined, "opus")
    expect(mocks.sidebarProps?.sourceFilter).toBe("user")
  })

  it("logs pending session handoff failures without consuming the prompt", async () => {
    const selectError = new Error("secret select prompt detail")
    const selectSession = vi.fn().mockRejectedValue(selectError)
    const sendMessage = vi.fn().mockResolvedValue(undefined)
    const onPendingAgentSessionConsumed = vi.fn()
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectSession,
      sendMessage,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            prompt: "Run this prompt",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(selectSession).toHaveBeenCalledWith(targetSession)
    expect(sendMessage).not.toHaveBeenCalled()
    expect(onPendingAgentSessionConsumed).not.toHaveBeenCalled()
    expect(mocks.rendererLogger.error).toHaveBeenCalledWith(
      "Agent pending session handoff failed.",
      {
        boundary: "renderer.agent.pending-session-handoff",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        targetSessionKey: "local:renderer",
        hasPrompt: true,
        promptLength: 15,
        errorName: "Error",
        errorLength: selectError.message.length,
      },
    )
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("secret select prompt detail")
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("Run this prompt")
  })

  it("does not consume a pending session prompt when sending returns false", async () => {
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(false)
    const onPendingAgentSessionConsumed = vi.fn()
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectSession,
      sendMessage,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentModule
          pendingAgentSession={{
            projectId: "project-1",
            conversationId: "conversation-1",
            prompt: "Run this prompt",
          }}
          onPendingAgentSessionConsumed={onPendingAgentSessionConsumed}
        />,
      )
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(selectSession).toHaveBeenCalledWith(targetSession)
    expect(sendMessage).toHaveBeenCalledWith("Run this prompt")
    expect(onPendingAgentSessionConsumed).not.toHaveBeenCalled()
  })

  it("shows a failure toast when a knowledge base command send fails", async () => {
    const sendMessage = vi.fn().mockResolvedValue(false)
    mocks.configProjects = [{
      id: "project-1",
      name: "Project One",
      path: "/repo",
      capabilities: {
        knowledgeBase: {
          enabled: true,
          managed: true,
          runtimeId: "kb-1",
          schemaVersion: 1,
          templateVersion: "test",
        },
      },
    }]
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      sendMessage,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    await act(async () => {
      await mocks.composerProps?.onKnowledgeBaseCommand?.("/wiki-lint ")
    })

    expect(sendMessage).toHaveBeenCalledWith("/wiki-lint", {
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })
    expect(mocks.toast.error).toHaveBeenCalledWith("发送失败")
  })

  it("hides knowledge base actions for incomplete managed knowledge base capabilities", async () => {
    mocks.configProjects = [{
      id: "project-1",
      name: "Project One",
      path: "/repo",
      capabilities: {
        knowledgeBase: {
          managed: true,
        },
      },
    } as SynapseProjectConfig]
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.knowledgeBaseActions).toEqual([])
  })

  it("logs transcript copy failures with sanitized conversation context", async () => {
    const transcriptError = new Error("secret transcript IPC detail")
    mocks.bridge.agent.getTimeline.mockRejectedValue(transcriptError)
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{ id: "entry-1", timestamp: "2026-05-13T00:00:00.000Z" }],
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button")?.click()
      await Promise.resolve()
    })

    expect(mocks.bridge.agent.getTimeline).toHaveBeenCalledWith({
      projectId: "project-1",
      sessionKey: "local:renderer",
      conversationId: "conversation-1",
    })
    expect(mocks.rendererLogger.error).toHaveBeenCalledWith(
      "Agent transcript copy failed.",
      {
        boundary: "renderer.agent.transcript-copy",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        errorName: "Error",
        errorLength: transcriptError.message.length,
      },
    )
    expect(JSON.stringify(mocks.rendererLogger.error.mock.calls)).not.toContain("secret transcript IPC detail")
    expect(mocks.toast).toHaveBeenCalledWith("复制失败")
  })

  it("logs reference open failures without an unhandled rejection", async () => {
    const openError = new Error("secret invalid reference detail")
    mocks.bridge.agent.openReference.mockRejectedValue(openError)
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    await act(async () => {
      mocks.timelineProps?.onOpenReference?.("APP/PC")
      await Promise.resolve()
    })

    expect(mocks.bridge.agent.openReference).toHaveBeenCalledWith({
      projectId: "project-1",
      reference: "APP/PC",
    })
    expect(mocks.rendererLogger.warn).toHaveBeenCalledWith(
      "Agent reference open failed.",
      {
        boundary: "renderer.agent.open-reference",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        referenceLength: 6,
        errorName: "Error",
        errorLength: openError.message.length,
      },
    )
    expect(JSON.stringify(mocks.rendererLogger.warn.mock.calls)).not.toContain("secret invalid reference detail")
    expect(mocks.toast).toHaveBeenCalledWith("打开失败")
  })

  it("logs reference open failures when the bridge is unavailable", async () => {
    mocks.bridgeAvailable = false
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    await act(async () => {
      mocks.timelineProps?.onOpenReference?.("APP/PC")
      await Promise.resolve()
    })

    expect(mocks.bridge.agent.openReference).not.toHaveBeenCalled()
    expect(mocks.rendererLogger.warn).toHaveBeenCalledWith(
      "Agent reference open failed.",
      {
        boundary: "renderer.agent.open-reference",
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
        referenceLength: 6,
        errorName: "BridgeUnavailable",
        errorLength: 0,
      },
    )
    expect(mocks.toast).toHaveBeenCalledWith("打开失败")
  })

  it("shows the idle jump button only when the selected conversation is off bottom and idle", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: false,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "Older answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: false,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(false)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(true)
  })

  it("keeps the unread jump button when off-bottom unread content exists after output stops", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: true,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "New answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: false,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(true)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(false)
  })

  it("does not show the idle jump button while Agent output is active", async () => {
    mocks.stickState = {
      isPinned: false,
      hasUnread: false,
    }
    mocks.chat = createChatState({
      sessions: [targetSession],
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      timeline: [{
        id: "message-1",
        kind: "message",
        role: "assistant",
        content: "Streaming answer",
        timestamp: "2026-06-01T00:00:00.000Z",
      }],
      sending: true,
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(<AgentModule />)
    })

    expect(mocks.composerProps?.showJumpToBottom).toBe(false)
    expect(mocks.composerProps?.showIdleJumpToBottom).toBe(false)
  })
})

function createChatState(overrides: Record<string, unknown> = {}) {
  return {
    sessions: [] as SynapseAgentSessionSummary[],
    archivedSessions: [] as SynapseAgentSessionSummary[],
    timeline: [],
    pendingPermissions: [],
    status: null,
    providers: null,
    commands: [],
        unreadByConversationId: {},
    selectedProjectId: undefined,
    selectedConversationId: undefined,
    selectedSessionKey: "local:renderer",
    activeProjectId: "project-1",
    loading: false,
    sending: false,
    cancelPhase: "idle" as const,
    error: null,
    currentConversationModel: undefined,
    createSession: vi.fn(),
    selectSession: vi.fn().mockResolvedValue(undefined),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    refresh: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue(true),
    respondPermission: vi.fn(),
    cancelTurn: vi.fn(),
    forceKillTurn: vi.fn(),
    ...overrides,
  }
}
