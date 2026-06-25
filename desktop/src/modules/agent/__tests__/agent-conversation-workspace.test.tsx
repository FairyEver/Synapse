/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import type { SynapseProjectConfig } from "@/types/config"
import { AgentConversationWorkspace } from "../components/agent-conversation-workspace"
import type { AgentConversationWorkspaceController } from "../components/agent-conversation-workspace"

vi.mock("../components/agent-composer", () => ({
  AgentComposer: (props: {
    readonly onStartNewConversation?: () => void
    readonly disabled?: boolean
    readonly quickInputs?: readonly { readonly content: string }[]
  }) => {
    return (
      <div data-testid="agent-composer">
        {props.quickInputs?.map((item) => <span key={item.content}>{item.content}</span>)}
        <button type="button" aria-label="新建对话" disabled={props.disabled} onClick={props.onStartNewConversation} />
      </div>
    )
  },
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
  delete (window as unknown as { synapse?: unknown }).synapse
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

  it("opens the rename dialog when double-clicking the conversation title", async () => {
    const onRename = vi.fn(async () => undefined)
    const container = renderWorkspace({
      mode: "embedded",
      onRename,
    })

    await act(async () => {
      container.querySelector("h2")
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })

    const input = document.body.querySelector<HTMLInputElement>("input")
    expect(document.body.textContent).toContain("重命名会话")
    expect(input?.value).toBe("新会话")
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe("新会话".length)

    await act(async () => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      if (!setter) throw new Error("Input value setter not found")
      setter.call(input, "需求复盘")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

    const saveButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "保存")
    await act(async () => {
      saveButton?.click()
    })

    expect(onRename).toHaveBeenCalledWith(session, "需求复盘")
  })

  it("hides detached button in window mode", () => {
    const container = renderWorkspace({ mode: "window" })

    expect(container.querySelector('button[aria-label="新窗口打开"]')).toBeNull()
  })

  it("does not render a source manager button in the conversation header", () => {
    const container = renderWorkspace({
      mode: "embedded",
      project: {
        id: "project-1",
        name: "知识库",
        path: "synapse-kb://project-1",
        capabilities: {
          knowledgeBase: {
            enabled: true,
            schemaVersion: 1,
            templateVersion: "test-template",
            managed: true,
            runtimeId: "runtime-1",
          },
        },
      },
    })

    expect(container.textContent).not.toContain("资料管理")
  })

  it("creates a replacement session from window mode and asks the page to retarget", async () => {
    const createdSession: SynapseAgentSessionSummary = {
      ...session,
      id: "conversation-2",
      name: "新会话 06:00 PM",
      active: true,
    }
    const createSession = vi.fn(async () => createdSession)
    const onReplaceDetachedTarget = vi.fn(async () => true)
    const container = renderWorkspace({
      mode: "window",
      chat: createController({ createSession }),
      onReplaceDetachedTarget,
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="新建对话"]')?.click()
    })

    expect(createSession).toHaveBeenCalledWith(
      "project-1",
      "provider-1",
      "default",
      "sonnet",
    )
    expect(onReplaceDetachedTarget).toHaveBeenCalledWith(createdSession)
  })

  it("does not ask embedded workspaces to retarget after creating a rollover session", async () => {
    const createdSession: SynapseAgentSessionSummary = {
      ...session,
      id: "conversation-2",
      name: "新会话 06:00 PM",
      active: true,
    }
    const createSession = vi.fn(async () => createdSession)
    const onReplaceDetachedTarget = vi.fn(async () => true)
    const container = renderWorkspace({
      mode: "embedded",
      chat: createController({ createSession }),
      onReplaceDetachedTarget,
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="新建对话"]')?.click()
    })

    expect(createSession).toHaveBeenCalled()
    expect(onReplaceDetachedTarget).not.toHaveBeenCalled()
  })

  it("loads quick inputs from the Quick Input bridge", async () => {
    const list = vi.fn(async () => [{
      id: "quick-1",
      schemaVersion: 1 as const,
      content: "桥接快捷输入",
      sortOrder: 10,
      createdAt: "2026-06-25T00:00:00.000Z",
      updatedAt: "2026-06-25T00:00:00.000Z",
    }])
    ;(window as unknown as {
      synapse?: {
        quickInput: {
          list: typeof list
          onChanged: () => () => void
        }
      }
    }).synapse = {
      quickInput: {
        list,
        onChanged: () => () => undefined,
      },
    }

    const container = renderWorkspace({ mode: "embedded" })

    await act(async () => {
      await Promise.resolve()
    })

    expect(list).toHaveBeenCalled()
    expect(container.textContent).toContain("桥接快捷输入")
  })
})

function renderWorkspace(options: {
  readonly mode: "embedded" | "window"
  readonly onOpenDetached?: (target: { projectId: string; conversationId: string; sessionKey: string }) => void
  readonly project?: SynapseProjectConfig
  readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean>
  readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  readonly chat?: AgentConversationWorkspaceController
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(
      <AgentConversationWorkspace
        session={session}
        project={options.project}
        target={{ projectId: "project-1", conversationId: "conversation-1", sessionKey: "local:renderer" }}
        chat={options.chat ?? createController()}
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
        onReplaceDetachedTarget={options.onReplaceDetachedTarget}
        onRename={options.onRename}
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
