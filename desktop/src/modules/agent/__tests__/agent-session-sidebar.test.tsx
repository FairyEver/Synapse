/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentSessionSidebar } from "../components/agent-session-sidebar"

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      agent: {
        defaultProviderModel: null,
      },
    },
  }),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = vi.fn()

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
  vi.restoreAllMocks()
})

describe("AgentSessionSidebar", () => {
  it("defaults to user conversations and filters by source", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[
            {
              projectId: "project-1",
              id: "user-conv",
              sessionKey: "local:renderer",
              platform: "local-renderer",
              name: "User Chat",
              active: true,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:01:00.000Z",
            },
            {
              projectId: "project-1",
              id: "task-conv",
              sessionKey: "scheduled:project-1:1",
              platform: "scheduled",
              name: "Scheduled Run",
              active: false,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:02:00.000Z",
            },
            {
              projectId: "project-1",
              id: "workflow-conv",
              sessionKey: "workflow:run-1",
              platform: "workflow",
              name: "Workflow Run",
              active: false,
              historyCount: 1,
              createdAt: "2026-05-21T00:00:00.000Z",
              updatedAt: "2026-05-21T00:03:00.000Z",
            },
          ]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
          selectedProjectId="project-1"
          selectedConversationId="workflow-conv"
          unreadByConversationId={{}}
          onCreateSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent).toContain("用户对话")
    expect(document.body.textContent).toContain("User Chat")
    expect(document.body.textContent).not.toContain("Scheduled Run")
    expect(document.body.textContent).not.toContain("Workflow Run")

    await act(async () => {
      document.querySelector<HTMLButtonElement>("[role='combobox']")?.click()
    })

    const workflowOption = [...document.querySelectorAll<HTMLElement>("[role='option']")]
      .find((item) => item.textContent === "工作流")
    expect(workflowOption).toBeDefined()

    await act(async () => {
      workflowOption?.click()
    })

    expect(document.body.textContent).not.toContain("User Chat")
    expect(document.body.textContent).not.toContain("Scheduled Run")
    expect(document.body.textContent).toContain("Workflow Run")
  })

  it("renders an unread marker for an inactive session", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "external-conv",
          sessionKey: "external:group:user",
          platform: "local-renderer",
          sourceLabel: "Dev Group / User One",
          active: false,
          historyCount: 2,
          createdAt: "2026-04-27T00:00:00.000Z",
          updatedAt: "2026-04-27T01:00:00.000Z",
        }]}
        archivedSessions={[]}
        projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
        selectedProjectId="project-local"
        selectedConversationId="local-conv"
        unreadByConversationId={{ "project-1:external-conv": 2 }}
        onCreateSession={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain("Dev Group / User One")
    expect(html).toContain("2<span class=\"sr-only\"> 条未读</span>")
  })

  it("requires a provider selection before creating a session", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([
            {
              id: "anthropic",
              name: "Anthropic",
              category: "official",
              apiKeyField: "ANTHROPIC_API_KEY",
              active: false,
              model: "claude-sonnet-4-5",
              sonnetModel: "claude-sonnet-4-5",
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
            {
              id: "openrouter",
              name: "OpenRouter",
              category: "aggregator",
              apiKeyField: "ANTHROPIC_AUTH_TOKEN",
              active: true,
              model: "claude-opus-4",
              sonnetModel: "claude-sonnet-4-5",
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          ]),
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
          selectedProjectId="project-1"
          selectedConversationId={undefined}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[title='新建会话']")?.click()
    })

    expect(onCreateSession).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("选择供应商 + 模型")
    expect(document.body.textContent).toContain("OpenRouter")

    // Click the Anthropic row to select it
    const anthropicRow = [...document.querySelectorAll("tr")]
      .find((row) => row.textContent?.includes("Anthropic"))
    expect(anthropicRow).toBeDefined()

    await act(async () => {
      anthropicRow?.click()
    })

    expect(onCreateSession).not.toHaveBeenCalled()

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")
    expect(confirmButton).toBeDefined()

    await act(async () => {
      confirmButton?.click()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    })
  })

  it("shows the dialog even when only one provider is available", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockResolvedValue([
            {
              id: "anthropic",
              name: "Anthropic",
              category: "official",
              apiKeyField: "ANTHROPIC_API_KEY",
              active: true,
              readonly: true,
              model: "claude-sonnet-4-5",
              sonnetModel: "claude-sonnet-4-5",
              createdAt: "2026-05-13T00:00:00.000Z",
              updatedAt: "2026-05-13T00:00:00.000Z",
            },
          ]),
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
          selectedProjectId="project-1"
          selectedConversationId={undefined}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[title='新建会话']")?.click()
    })

    expect(onCreateSession).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("选择供应商 + 模型")

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")

    await act(async () => {
      confirmButton?.click()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    })
  })

  it("logs provider list failures without exposing the raw error message", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders: vi.fn().mockRejectedValue(new Error("secret provider backend failed")),
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
          selectedProjectId="project-1"
          selectedConversationId={undefined}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[title='新建会话']")?.click()
      await Promise.resolve()
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent provider list failed.", {
      boundary: "renderer.provider-model-select",
      errorLength: "secret provider backend failed".length,
      errorName: "Error",
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret provider backend failed")
  })

  it("does not create with a stale provider after provider refresh fails", async () => {
    const onCreateSession = vi.fn()
    const listProviders = vi.fn()
      .mockResolvedValueOnce([
        {
          id: "anthropic",
          name: "Anthropic",
          category: "official",
          apiKeyField: "ANTHROPIC_API_KEY",
          active: true,
          model: "claude-sonnet-4-5",
          sonnetModel: "claude-sonnet-4-5",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
        {
          id: "openrouter",
          name: "OpenRouter",
          category: "aggregator",
          apiKeyField: "ANTHROPIC_AUTH_TOKEN",
          active: false,
          model: "claude-opus-4",
          sonnetModel: "claude-sonnet-4-5",
          createdAt: "2026-05-13T00:00:00.000Z",
          updatedAt: "2026-05-13T00:00:00.000Z",
        },
      ])
      .mockRejectedValueOnce(new Error("provider backend failed"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listProviders,
        },
      },
    })

    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[]}
          archivedSessions={[]}
          projects={[
            { id: "project-1", name: "Project One", path: "/tmp/one" },
            { id: "project-2", name: "Project Two", path: "/tmp/two" },
          ]}
          selectedProjectId="project-1"
          selectedConversationId={undefined}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>("button[title='新建会话']")[0]?.click()
    })
    expect(document.body.textContent).toContain("Anthropic")

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "取消")
        ?.click()
    })

    await act(async () => {
      document.querySelectorAll<HTMLButtonElement>("button[title='新建会话']")[1]?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(onCreateSession).not.toHaveBeenCalled()
  })
})
