/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { AgentModule } from "../index"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  chat: null as unknown,
  useAgentChat: vi.fn(),
  forcePin: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [{ id: "project-1", name: "Project One", path: "/repo" }],
      },
    },
  }),
}))

vi.mock("@/app-shell/use-repository-manager", () => ({
  useActiveRepository: () => ({ uuid: "project-1", name: "Project One", localPath: "/repo" }),
}))

vi.mock("@/lib/runtime-platform", () => ({
  getRendererPlatform: () => "darwin",
}))

vi.mock("../hooks/use-agent-chat", () => ({
  useAgentChat: mocks.useAgentChat,
}))

vi.mock("../hooks/use-stick-to-bottom", () => ({
  useStickToBottom: () => ({
    forcePin: mocks.forcePin,
    viewportRef: { current: null },
    isPinned: true,
    hasUnread: false,
    scrollToBottom: vi.fn(),
  }),
}))

vi.mock("@/components/sidebar-content-layout", () => ({
  SidebarContentLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}))

vi.mock("../components/agent-session-sidebar", () => ({
  AgentSessionSidebar: () => <aside />,
}))

vi.mock("../components/agent-timeline", () => ({
  AgentTimeline: () => <section />,
}))

vi.mock("../components/agent-composer", () => ({
  AgentComposer: () => <form />,
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
  mocks.useAgentChat.mockImplementation(() => mocks.chat)
})

describe("AgentModule pending prompt sessions", () => {
  it("refreshes missing pending sessions before selecting and sending the prompt", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined)
    const selectSession = vi.fn().mockResolvedValue(undefined)
    const sendMessage = vi.fn().mockResolvedValue(undefined)
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
    followFeishu: false,
    setFollowFeishu: vi.fn(),
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
    sendMessage: vi.fn().mockResolvedValue(undefined),
    respondPermission: vi.fn(),
    cancelTurn: vi.fn(),
    forceKillTurn: vi.fn(),
    ...overrides,
  }
}
