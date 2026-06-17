/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { AgentConversationWorkspace } from "../components/agent-conversation-workspace"
import type { AgentConversationWorkspaceController } from "../components/agent-conversation-workspace"

vi.mock("../components/agent-composer", () => ({
  AgentComposer: () => <div data-testid="agent-composer" />,
}))

vi.mock("../components/agent-timeline", () => ({
  AgentTimeline: () => <div data-testid="agent-timeline" />,
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
  providerId: "provider-1",
  modelTier: "sonnet",
  agentType: "claude-code",
}

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AgentConversationWorkspace", () => {
  it("renders embedded conversation controls and opens detached window", () => {
    const onOpenDetached = vi.fn()
    const container = renderWorkspace({
      mode: "embedded",
      onOpenDetached,
    })

    expect(container.textContent).toContain("新会话")
    const button = container.querySelector('button[aria-label="新窗口打开"]')
    expect(button).not.toBeNull()
    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(onOpenDetached).toHaveBeenCalledWith({
      projectId: "project-1",
      conversationId: "conversation-1",
      sessionKey: "local:renderer",
    })
  })

  it("hides detached button in window mode", () => {
    const container = renderWorkspace({ mode: "window" })

    expect(container.querySelector('button[aria-label="新窗口打开"]')).toBeNull()
  })
})

function renderWorkspace(options: {
  readonly mode: "embedded" | "window"
  readonly onOpenDetached?: (target: { projectId: string; conversationId: string; sessionKey: string }) => void
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <AgentConversationWorkspace
        session={session}
        target={{ projectId: "project-1", conversationId: "conversation-1", sessionKey: "local:renderer" }}
        chat={createController()}
        quickInputs={[]}
        commands={[]}
        providers={{
          agentType: "claude-code",
          activeProviderId: "provider-1",
          providers: [{ id: "provider-1", display: "百炼", active: true, scope: "global" }],
        }}
        currentConversationModel="glm-5.1"
        displayProfile={{
          agentLabel: "Agent",
          thinkingDefaultCollapsed: false,
          toolDefaultCollapsed: "auto",
          toolPreviewLines: 6,
          toolPreviewChars: 1200,
          statusLabels: {
            pending: "Pending",
            running: "Running",
            success: "Done",
            error: "Failed",
            denied: "Denied",
          },
        }}
        mode={options.mode}
        onOpenDetached={options.onOpenDetached}
      />,
    )
  })
  return container
}

function createController(
  overrides: Partial<AgentConversationWorkspaceController> = {},
): AgentConversationWorkspaceController {
  return {
    timeline: [],
    pendingPermissions: [],
    sending: false,
    sendingConversationIds: new Set(),
    cancelPhase: "idle",
    error: null,
    sendMessage: vi.fn(async () => true),
    createSession: vi.fn(async () => undefined),
    setPermissionMode: vi.fn(async () => undefined),
    respondPermission: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
    forceKillTurn: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...overrides,
  }
}
