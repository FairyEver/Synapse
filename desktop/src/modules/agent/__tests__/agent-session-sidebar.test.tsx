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

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
  it("renders the follow Feishu control and unread marker", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "feishu-conv",
          sessionKey: "feishu:oc_group:ou_user",
          platform: "feishu",
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
        followFeishu={true}
        unreadByConversationId={{ "project-1:feishu-conv": 2 }}
        onCreateSession={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
        onFollowFeishuChange={vi.fn()}
      />,
    )

    expect(html).toContain("跟随飞书")
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
          followFeishu={false}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
          onFollowFeishuChange={vi.fn()}
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

    expect(onCreateSession).toHaveBeenCalledWith("project-1", { providerId: "anthropic", modelTier: "sonnet" })
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
          followFeishu={false}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
          onFollowFeishuChange={vi.fn()}
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

    expect(onCreateSession).toHaveBeenCalledWith("project-1", { providerId: "anthropic", modelTier: "sonnet" })
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
          followFeishu={false}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
          onFollowFeishuChange={vi.fn()}
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
          followFeishu={false}
          unreadByConversationId={{}}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
          onFollowFeishuChange={vi.fn()}
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
