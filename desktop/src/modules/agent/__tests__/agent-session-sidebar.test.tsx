/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentSessionSidebar } from "../components/agent-session-sidebar"
import { AgentSidebarSessionRow } from "../components/agent-sidebar-session-row"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "@/lib/default-agent-workspace"
import * as createSessionName from "../create-session-name"

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
  it("renders the local conversation project instead of blocking on missing configured projects", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[]}
        archivedSessions={[]}
        projects={[DEFAULT_AGENT_WORKSPACE_PROJECT]}
        selectedProjectId={DEFAULT_AGENT_WORKSPACE_PROJECT.id}
        selectedConversationId={undefined}
        sourceFilter="user"
        unreadByConversationId={{}}
        sendingConversationIds={new Set()}
        onCreateSession={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain("本地对话")
    expect(html).toContain("新建会话")
    expect(html).not.toContain("尚未配置项目")
    expect(html).not.toContain("添加项目后即可开始 Agent 对话")
  })

  it("lets users edit the generated name before creating a session", async () => {
    vi.spyOn(createSessionName, "formatCreateSessionName").mockReturnValue("新对话 13:30")
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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

    const input = document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")
    expect(input?.value).toBe("新对话 13:30")

    await act(async () => {
      if (!input) return
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
      if (!setter) throw new Error("Input value setter not found")
      setter.call(input, "需求复盘")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })

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
    }, "需求复盘")
  })

  it("allows long session titles to truncate inside the sidebar", () => {
    const longTitle = "能力矩阵回归测试工作流 / 8A. 通道聚合与边界校验 · 05-22 21:19"
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "workflow-conv",
          sessionKey: "local:renderer",
          platform: "local-renderer",
          name: longTitle,
          active: true,
          historyCount: 1,
          createdAt: "2026-05-22T13:19:00.000Z",
          updatedAt: "2026-05-22T13:19:00.000Z",
        }]}
        archivedSessions={[]}
        projects={[{ id: "project-1", name: "Synapse", path: "/tmp/synapse" }]}
        selectedProjectId="project-1"
        selectedConversationId="workflow-conv"
        sourceFilter="user"
        unreadByConversationId={{ "project-1:workflow-conv": 1 }}
        sendingConversationIds={new Set()}
        onCreateSession={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const title = [...wrapper.querySelectorAll("span")]
      .find((span) => span.textContent === longTitle && span.className.includes("truncate"))

    expect(title?.className).toContain("truncate")
    expect(title?.className).toContain("min-w-0")
    expect(title?.parentElement?.className).toContain("min-w-0")

    const list = [...wrapper.querySelectorAll("div")]
      .find((element) => element.className.includes("flex-col") && element.textContent?.includes(longTitle))
    const sidebarList = wrapper.querySelector('[data-track="agent-session-list"]')
    expect(sidebarList?.className).toContain("overflow-y-auto")
    expect(sidebarList?.className).toContain("overflow-x-hidden")
    expect(sidebarList?.className).toContain("min-w-0")
    expect(list?.className).toContain("w-full")

    const indentedSessionList = [...wrapper.querySelectorAll("div")]
      .find((element) => element.className.includes("pl-3") && element.textContent?.includes(longTitle))
    expect(indentedSessionList?.className).toContain("w-full")
    expect(indentedSessionList?.className).toContain("min-w-0")

    const row = wrapper.querySelector('[data-track="agent-session-select"][aria-current="page"]')
    expect(row?.className).toContain("w-full")
    expect(row?.className).toContain("min-w-0")
    expect(row?.getAttribute("role")).toBe("button")
    expect(row?.querySelector("span")?.className).toContain("flex-1")
  })

  it("selects a session when clicking the row trailing area", async () => {
    const onSelect = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSidebarSessionRow
          active={false}
          trailing={<span data-testid="session-trailing">1 小时</span>}
          trackValue="project-1:conversation-1"
          onSelect={onSelect}
        >
          新会话 08:32 PM
        </AgentSidebarSessionRow>,
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>("[data-testid='session-trailing']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it("keeps compact session actions on the same rail as project actions", () => {
    const html = renderToStaticMarkup(
      <AgentSidebarSessionRow
        active={false}
        trailing={<span data-testid="session-trailing">status</span>}
        trackValue="project-1:conversation-1"
        onSelect={vi.fn()}
      >
        新会话 08:32 PM
      </AgentSidebarSessionRow>,
    )

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const trailingRail = [...wrapper.querySelectorAll("span")]
      .find((span) => span.textContent === "status" && span.className.includes("shrink-0"))

    expect(trailingRail?.className).toContain("min-w-6")
    expect(trailingRail?.className).toContain("justify-center")
  })

  it("defaults to user conversations and filters by source", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)
    let sourceFilter: "user" | "workflow" = "user"

    const renderSidebar = () => {
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
          sourceFilter={sourceFilter}
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={vi.fn()}
          onSourceFilterChange={(next) => {
            sourceFilter = next as typeof sourceFilter
            renderSidebar()
          }}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    }

    await act(async () => {
      renderSidebar()
    })

    expect(document.body.textContent).toContain("用户对话")
    expect(document.body.textContent).toContain("User Chat")
    expect(document.body.textContent).not.toContain("Scheduled Run")
    expect(document.body.textContent).not.toContain("Workflow Run")

    await act(async () => {
      Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
        configurable: true,
        value: () => false,
      })
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: vi.fn(),
      })
      const sourceTrigger = document.querySelector<HTMLButtonElement>("button[aria-label='会话来源']")
      expect(sourceTrigger).toBeDefined()
      sourceTrigger!.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      sourceTrigger!.click()
      sourceTrigger!.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }))
      await Promise.resolve()
    })

    await act(async () => {
      const workflowOption = [...document.querySelectorAll<HTMLElement>("[role='option']")]
        .find((option) => option.textContent?.includes("工作流"))
      expect(workflowOption).toBeDefined()
      workflowOption!.click()
      await Promise.resolve()
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
        sourceFilter="user"
        unreadByConversationId={{ "project-1:external-conv": 2 }}
        sendingConversationIds={new Set()}
        onCreateSession={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain("Dev Group / User One")
    expect(html).toContain("bg-blue-500")
    expect(html).toContain("未读")
    expect(html).not.toContain(">2<")
  })

  it("renders running status from sending conversation ids", () => {
    const html = renderToStaticMarkup(
      <AgentSessionSidebar
        sessions={[{
          projectId: "project-1",
          id: "running-conv",
          sessionKey: "local:renderer",
          platform: "local-renderer",
          name: "Active Session",
          active: true,
          historyCount: 1,
          createdAt: "2026-06-04T05:00:00.000Z",
          updatedAt: "2026-06-04T05:58:00.000Z",
        }]}
        archivedSessions={[]}
        projects={[{ id: "project-1", name: "Test Project", path: "/tmp/test" }]}
        selectedProjectId="project-other"
        selectedConversationId="other-conv"
        sourceFilter="user"
        unreadByConversationId={{ "project-1:running-conv": 4 }}
        sendingConversationIds={new Set(["running-conv"])}
        onCreateSession={vi.fn()}
        onSourceFilterChange={vi.fn()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain("Active Session")
    expect(html).toContain("animate-spin")
    expect(html).toContain("正在输出")
    expect(html).not.toContain(">4<")
    expect(html).not.toContain("未读")
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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
    }, expect.any(String))
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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
    }, expect.any(String))
  })

  it("keeps provider selection open until session creation finishes", async () => {
    let finishCreate: (() => void) | undefined
    const onCreateSession = vi.fn(() => new Promise<void>((resolve) => {
      finishCreate = resolve
    }))
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "确认")

    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("正在保存...")
    expect(document.body.textContent).toContain("选择供应商 + 模型")

    await act(async () => {
      finishCreate?.()
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("选择供应商 + 模型")
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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
          sourceFilter="user"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSourceFilterChange={vi.fn()}
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
