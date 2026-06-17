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
  workspaceProps: null as { readonly mode?: string; readonly session?: SynapseAgentSessionSummary } | null,
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
  AgentConversationWorkspace: (props: { readonly mode: string; readonly session: SynapseAgentSessionSummary }) => {
    mocks.workspaceProps = props
    return (
      <section>
        <h1>{props.session.name}</h1>
        {props.mode === "embedded" ? <button type="button" aria-label="新窗口打开" /> : null}
      </section>
    )
  },
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

let roots: Root[] = []

beforeEach(() => {
  mocks.chat = createChatState({ sessions: [session] })
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
  })

  it("shows missing conversation state", () => {
    const container = renderPage("missing")

    expect(container.textContent).toContain("对话不存在或已删除")
  })
})

function renderPage(conversationId: string) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
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
