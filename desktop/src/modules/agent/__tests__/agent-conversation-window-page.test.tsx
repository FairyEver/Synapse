/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { AgentConversationWindowPage } from "../components/agent-conversation-window-page"

const mocks = vi.hoisted(() => ({
  chat: null as unknown,
  replaceConversationWindowTarget: vi.fn(),
  workspaceProps: null as {
    readonly mode?: string
    readonly session: SynapseAgentSessionSummary
    readonly chat?: unknown
    readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean>
    readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  } | null,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [{ id: "project-1", name: "Project One", path: "/repo" }],
        quickInputs: [],
      },
    },
  }),
}))

vi.mock("../hooks/use-agent-chat", () => ({
  useAgentChat: () => mocks.chat,
}))

vi.mock("../components/agent-conversation-workspace", () => ({
  AgentConversationWorkspace: (props: {
    readonly mode: string
    readonly session: SynapseAgentSessionSummary
    readonly chat?: unknown
    readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean>
    readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  }) => {
    mocks.workspaceProps = props
    return (
      <section>
        <h1>{props.session.name}</h1>
        <button
          type="button"
          aria-label="模拟替换窗口目标"
          onClick={() => void props.onReplaceDetachedTarget?.(nextSession)}
        />
        {props.mode === "embedded" ? <button type="button" aria-label="新窗口打开" /> : null}
      </section>
    )
  },
}))

vi.mock("@/lib/electron-bridge", () => ({
  requireSynapseBridge: () => ({
    agent: {
      replaceConversationWindowTarget: mocks.replaceConversationWindowTarget,
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const session: SynapseAgentSessionSummary = {
  id: "conversation-1",
  projectId: "project-1",
  sessionKey: "local:renderer",
  platform: "local-renderer",
  name: "新会话",
  active: true,
  createdAt: "2026-06-17T00:00:00.000Z",
  updatedAt: "2026-06-17T00:00:00.000Z",
  historyCount: 0,
  mode: "default",
  agentType: "claude-code",
}

const nextSession: SynapseAgentSessionSummary = {
  ...session,
  id: "conversation-2",
  name: "新会话 06:00 PM",
  updatedAt: "2026-06-17T10:00:00.000Z",
}

let roots: Root[] = []

beforeEach(() => {
  mocks.chat = createChatState({ sessions: [session] })
  mocks.replaceConversationWindowTarget.mockResolvedValue({ replaced: true })
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  mocks.chat = null
  mocks.workspaceProps = null
  vi.clearAllMocks()
})

describe("AgentConversationWindowPage", () => {
  it("renders a fixed conversation workspace", () => {
    const container = renderPage("conversation-1")

    expect(container.textContent).toContain("新会话")
    expect(container.querySelector('button[aria-label="新窗口打开"]')).toBeNull()
    expect(mocks.workspaceProps?.mode).toBe("window")
    expect(mocks.workspaceProps?.onRename).toBe((mocks.chat as { renameSession: unknown }).renameSession)
  })

  it("passes the independent window realtime context state to the shared workspace", () => {
    const contextUsage = {
      usedTokens: 58_000,
      contextWindowTokens: 200_000,
      model: "claude-sonnet-4-5",
    }
    renderPage("conversation-1", { contextUsage })

    expect(mocks.workspaceProps?.chat).toMatchObject({ contextUsage })
  })

  it("shows a neutral loading state while an existing conversation is hydrating", () => {
    const container = renderPage("conversation-1", { loading: true })

    expect(container.textContent).toContain("加载中")
    expect(mocks.workspaceProps).toBeNull()
    expect((mocks.chat as { selectSession: ReturnType<typeof vi.fn> }).selectSession).not.toHaveBeenCalled()
  })

  it("shows missing conversation state", () => {
    const container = renderPage("missing")

    expect(container.textContent).toContain("对话不存在或已删除")
  })

  it("retargets the current window to a newly created session", async () => {
    const container = renderPage("conversation-1", {
      sessions: [session, nextSession],
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="模拟替换窗口目标"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(mocks.replaceConversationWindowTarget).toHaveBeenCalledWith({
      from: {
        projectId: "project-1",
        conversationId: "conversation-1",
        sessionKey: "local:renderer",
      },
      to: {
        projectId: "project-1",
        conversationId: "conversation-2",
        sessionKey: "local:renderer",
        title: "新会话 06:00 PM",
      },
    })
    expect(mocks.workspaceProps?.session.id).toBe("conversation-2")
    expect(window.location.search).toContain("conversationId=conversation-2")
  })

  it("keeps the current window on the old session when retargeting fails", async () => {
    mocks.replaceConversationWindowTarget.mockResolvedValue({ replaced: false })
    const selectSession = vi.fn(async () => undefined)
    const container = renderPage("conversation-1", {
      sessions: [session, nextSession],
      selectSession,
    })

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="模拟替换窗口目标"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(mocks.workspaceProps?.session.id).toBe("conversation-1")
    expect(selectSession).toHaveBeenCalledWith(session)
    expect(container.textContent).toContain("打开失败")
    expect(window.location.search).toContain("conversationId=conversation-1")
  })
})

function renderPage(conversationId: string, chatOverrides: Record<string, unknown> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  window.history.replaceState({}, "", `/?synapseWindow=agent-conversation&projectId=project-1&conversationId=${conversationId}&sessionKey=local%3Arenderer&title=%E6%96%B0%E4%BC%9A%E8%AF%9D`)
  const root = createRoot(container)
  roots.push(root)
  mocks.chat = createChatState({ sessions: [session], ...chatOverrides })
  act(() => {
    root.render(
      <AgentConversationWindowPage
        request={{
          projectId: "project-1",
          conversationId,
          sessionKey: "local:renderer",
          title: "新会话",
        }}
      />,
    )
  })
  return container
}

function createChatState(overrides: Record<string, unknown> = {}) {
  return {
    sessions: [] as SynapseAgentSessionSummary[],
    archivedSessions: [] as SynapseAgentSessionSummary[],
    timeline: [],
    pendingPermissions: [],
    sending: false,
    sendingConversationIds: new Set(),
    cancelPhase: "idle" as const,
    error: null,
    providers: null,
    commands: [],
    currentConversationModel: undefined,
    contextUsage: undefined,
    selectedProjectId: "project-1",
    selectedConversationId: "conversation-1",
    selectedSessionKey: "local:renderer",
    activeProjectId: "project-1",
    loading: false,
    createSession: vi.fn(),
    selectSession: vi.fn(async () => undefined),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
    refresh: vi.fn(async () => undefined),
    sendMessage: vi.fn(async () => true),
    setPermissionMode: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
    forceKillTurn: vi.fn(async () => undefined),
    ...overrides,
  }
}
