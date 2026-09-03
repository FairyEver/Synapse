/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentPublishedCommand, SynapseAgentSessionSummary } from "@/types/agent"
import type { SynapseProjectConfig } from "@/types/config"
import { AgentConversationWorkspace } from "../components/agent-conversation-workspace"
import type { AgentConversationWorkspaceController } from "../components/agent-conversation-workspace"

const mocks = vi.hoisted(() => ({
  referenceActions: {
    openDefault: vi.fn(),
    showInFolder: vi.fn(),
  },
  timelineProps: [] as Array<{ readonly referenceActions?: unknown }>,
  composerProps: [] as Array<{
    readonly draft: string
    readonly onDraftChange: (value: string) => void
    readonly onSubmit: (
      event: { preventDefault: () => void },
      attachments: readonly [],
      acceptAttachments: () => () => void,
    ) => void
    readonly recentSlashSkills?: readonly string[]
  }>,
  config: {
    agent: {
      defaultProviderModel: {
        providerId: "provider-1",
        providerName: "百炼",
        modelTier: "sonnet",
        modelName: "glm-5.1",
      },
      recentSlashSkills: [] as string[],
      allowedWriteDirectories: [],
    },
  },
  updateConfig: vi.fn(),
  useAgentReferenceActions: vi.fn(),
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: mocks.config,
    updateConfig: mocks.updateConfig,
  }),
}))

vi.mock("../components/agent-composer", () => ({
  AgentComposer: (props: {
    readonly draft: string
    readonly onStartNewConversation?: () => void
    readonly disabled?: boolean
    readonly quickInputs?: readonly { readonly content: string }[]
    readonly onDraftChange: (value: string) => void
    readonly onSubmit: (
      event: { preventDefault: () => void },
      attachments: readonly [],
      acceptAttachments: () => () => void,
    ) => void
    readonly recentSlashSkills?: readonly string[]
  }) => {
    mocks.composerProps.push(props)
    return (
      <div data-testid="agent-composer">
        {props.quickInputs?.map((item) => <span key={item.content}>{item.content}</span>)}
        <button type="button" aria-label="新建对话" disabled={props.disabled} onClick={props.onStartNewConversation} />
      </div>
    )
  },
}))

vi.mock("../components/agent-timeline", () => ({
  AgentTimeline: (props: { readonly referenceActions?: unknown }) => {
    mocks.timelineProps.push(props)
    return <div data-testid="agent-timeline" />
  },
}))

vi.mock("../hooks/use-agent-reference-actions", () => ({
  useAgentReferenceActions: mocks.useAgentReferenceActions,
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

beforeEach(() => {
  mocks.timelineProps.length = 0
  mocks.composerProps.length = 0
  mocks.config.agent.recentSlashSkills = []
  mocks.updateConfig.mockResolvedValue(mocks.config)
  mocks.useAgentReferenceActions.mockReturnValue(mocks.referenceActions)
  Object.defineProperty(window, "synapse", {
    configurable: true,
    writable: true,
    value: {
      agent: {
        listAllProviders: vi.fn(async () => [{
          id: "provider-1",
          name: "百炼",
          category: "official",
          apiKeyField: "ANTHROPIC_API_KEY",
          active: true,
          model: "glm-5.1",
          sonnetModel: "glm-5.1",
          createdAt: "2026-07-20T00:00:00.000Z",
          updatedAt: "2026-07-20T00:00:00.000Z",
        }]),
      },
    },
  })
})

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
  it("injects the same reference actions into the shared main and detached timeline path", () => {
    renderWorkspace({ mode: "embedded" })
    const embeddedProps = mocks.timelineProps.at(-1)
    renderWorkspace({ mode: "window" })
    const detachedProps = mocks.timelineProps.at(-1)

    expect(mocks.useAgentReferenceActions).toHaveBeenNthCalledWith(1, "project-1")
    expect(mocks.useAgentReferenceActions).toHaveBeenNthCalledWith(2, "project-1")
    expect(embeddedProps?.referenceActions).toBe(mocks.referenceActions)
    expect(detachedProps?.referenceActions).toBe(mocks.referenceActions)
  })

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
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(onRename).toHaveBeenCalledWith(session, "需求复盘")
    expect(document.activeElement).toBe(container.querySelector("h2"))
  })

  it("hides detached button in window mode", () => {
    const container = renderWorkspace({ mode: "window" })

    expect(container.querySelector('button[aria-label="新窗口打开"]')).toBeNull()
  })

  it.each(["embedded", "window"] as const)(
    "shows the shared context indicator in %s mode",
    (mode) => {
      const container = renderWorkspace({
        mode,
        chat: createController({
          contextUsage: {
            usedTokens: 58_000,
            contextWindowTokens: 200_000,
            model: "glm-5.1",
          },
        }),
      })

      expect(container.textContent).toContain("上下文 58K / 200K · 29%")
      expect(container.querySelector("[data-agent-context-usage]")).not.toBeNull()
    },
  )

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

  it("does not show pending questions from another conversation in the header", () => {
    const container = renderWorkspace({
      mode: "embedded",
      chat: createController({
        pendingPermissions: [{
          requestId: "question-1",
          projectId: "project-1",
          sessionKey: "local:renderer",
          conversationId: "conversation-2",
          toolName: "AskUserQuestion",
          createdAt: "2026-06-17T00:01:00.000Z",
        }],
      }),
    })

    expect(container.textContent).not.toContain("待回答 1")
  })

  it("clears an unsent draft when switching conversations", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(workspaceElement({ mode: "embedded" }))
    })
    await act(async () => {
      mocks.composerProps.at(-1)?.onDraftChange("conversation-one-draft")
    })
    expect(mocks.composerProps.at(-1)?.draft).toBe("conversation-one-draft")

    await act(async () => {
      root.render(workspaceElement({
        mode: "embedded",
        session: {
          ...session,
          id: "conversation-2",
          sessionKey: "local:conversation-2",
          name: "第二个会话",
        },
        target: {
          projectId: "project-1",
          conversationId: "conversation-2",
          sessionKey: "local:conversation-2",
        },
      }))
      await Promise.resolve()
    })

    expect(mocks.composerProps.at(-1)?.draft).toBe("")
  })

  it("shows the fixed persona name in the conversation header", () => {
    const container = renderWorkspace({
      mode: "embedded",
      session: {
        ...session,
        activeMainThreadPersonaId: "persona-1",
        activeMainThreadPersonaName: "固定智能体",
      },
      chat: createController({
        personasLoaded: true,
        personas: [{
          id: "persona-1",
          schemaVersion: 1,
          name: "固定智能体",
          description: "固定身份",
          systemPrompt: "固定身份",
          providerModel: null,
          source: "user",
          readonly: false,
        }],
      }),
    })

    expect(container.textContent).toContain("固定智能体")
    expect(container.querySelector<HTMLButtonElement>('[aria-label="新建对话"]')?.disabled).toBe(false)
  })

  it("blocks sending when the fixed persona is unavailable and offers a new conversation", () => {
    const container = renderWorkspace({
      mode: "embedded",
      session: {
        ...session,
        activeMainThreadPersonaId: "missing-persona",
        activeMainThreadPersonaName: "已删除智能体",
      },
      chat: createController({ personasLoaded: true, personas: [] }),
    })

    expect(container.textContent).toContain("该智能体不可用，请新建对话。")
    expect(container.querySelector<HTMLButtonElement>('[aria-label="新建对话"]')?.disabled).toBe(true)
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
      await Promise.resolve()
    })
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "创建对话")
        ?.click()
      await Promise.resolve()
    })

    expect(createSession).toHaveBeenCalledWith(
      "project-1",
      "provider-1",
      "default",
      "sonnet",
      expect.any(String),
      null,
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
      await Promise.resolve()
    })
    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "创建对话")
        ?.click()
      await Promise.resolve()
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
          item: {
            list: typeof list
            onChanged: () => () => void
          }
        }
      }
    }).synapse = {
      quickInput: {
        item: {
          list,
          onChanged: () => () => undefined,
        },
      },
    }

    const container = renderWorkspace({ mode: "embedded" })

    await act(async () => {
      await Promise.resolve()
    })

    expect(list).toHaveBeenCalled()
    expect(container.textContent).toContain("桥接快捷输入")
  })

  it("records an available Skill after a successful manual Slash send", async () => {
    const sendMessage = vi.fn(async () => true)
    renderWorkspace({
      mode: "embedded",
      commands: [skillCommand("review-code")],
      chat: createController({ sendMessage }),
    })

    await submitComposerDraft("/review-code src/app.ts")

    expect(sendMessage).toHaveBeenCalledWith("/review-code src/app.ts", expect.any(Object))
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { recentSlashSkills: ["review-code"] },
    })
  })

  it("does not record a Skill when sending fails", async () => {
    renderWorkspace({
      mode: "embedded",
      commands: [skillCommand("review-code")],
      chat: createController({ sendMessage: vi.fn(async () => false) }),
    })

    await submitComposerDraft("/review-code")

    expect(mocks.updateConfig).not.toHaveBeenCalled()
  })

  it("records a queued Skill only after the queued send succeeds", async () => {
    const sendMessage = vi.fn(async () => true)
    renderWorkspace({
      mode: "embedded",
      commands: [skillCommand("review-code")],
      chat: createController({ sending: true, sendMessage }),
    })

    await submitComposerDraft("/review-code")
    await act(async () => {
      await Promise.resolve()
    })

    expect(sendMessage).toHaveBeenCalledWith(
      "/review-code",
      expect.any(Object),
      { attachments: [] },
    )
    expect(mocks.updateConfig).toHaveBeenCalledWith({
      agent: { recentSlashSkills: ["review-code"] },
    })
  })
})

async function submitComposerDraft(content: string): Promise<void> {
  await act(async () => {
    mocks.composerProps.at(-1)?.onDraftChange(content)
  })
  await act(async () => {
    mocks.composerProps.at(-1)?.onSubmit(
      { preventDefault: () => undefined },
      [],
      () => () => undefined,
    )
    await Promise.resolve()
  })
}

function skillCommand(name: string): SynapseAgentPublishedCommand {
  return {
    name,
    description: "Test Skill",
    source: "skill",
    kind: "skill",
    skillOrigin: "synapse-installed",
    adminOnly: false,
  }
}

function renderWorkspace(options: {
  readonly mode: "embedded" | "window"
  readonly session?: SynapseAgentSessionSummary
  readonly target?: { readonly projectId: string; readonly conversationId: string; readonly sessionKey: string }
  readonly onOpenDetached?: (target: { projectId: string; conversationId: string; sessionKey: string }) => void
  readonly project?: SynapseProjectConfig
  readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean>
  readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  readonly chat?: AgentConversationWorkspaceController
  readonly commands?: readonly SynapseAgentPublishedCommand[]
}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  act(() => {
    root.render(workspaceElement(options))
  })
  return container
}

function workspaceElement(options: {
  readonly mode: "embedded" | "window"
  readonly session?: SynapseAgentSessionSummary
  readonly target?: { readonly projectId: string; readonly conversationId: string; readonly sessionKey: string }
  readonly onOpenDetached?: (target: { projectId: string; conversationId: string; sessionKey: string }) => void
  readonly project?: SynapseProjectConfig
  readonly onReplaceDetachedTarget?: (session: SynapseAgentSessionSummary) => Promise<boolean>
  readonly onRename?: (session: SynapseAgentSessionSummary, name: string) => Promise<void>
  readonly chat?: AgentConversationWorkspaceController
  readonly commands?: readonly SynapseAgentPublishedCommand[]
}) {
  return (
    <AgentConversationWorkspace
        session={options.session ?? session}
        project={options.project}
        target={options.target ?? { projectId: "project-1", conversationId: "conversation-1", sessionKey: "local:renderer" }}
        chat={options.chat ?? createController()}
        quickInputs={[]}
        commands={options.commands ?? []}
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
    />
  )
}

function createController(
  overrides: Partial<AgentConversationWorkspaceController> = {},
): AgentConversationWorkspaceController {
  return {
    timeline: [],
    timelineHasMore: false,
    loadingOlder: false,
    timelineHistoryError: null,
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
    loadOlderTimeline: vi.fn(async () => undefined),
    personas: [],
    personasLoaded: true,
    contextUsage: undefined,
    ...overrides,
  }
}
