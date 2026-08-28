/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AgentSessionSidebar } from "../components/agent-session-sidebar"
import { AgentSidebarSessionRow } from "../components/agent-sidebar-session-row"
import { DEFAULT_AGENT_WORKSPACE_PROJECT } from "@/lib/default-agent-workspace"
import type { SynapseAgentProvider } from "@/types/bridge"
import * as createSessionName from "../create-session-name"

const rendererLogger = vi.hoisted(() => ({
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}))

const appConfig = vi.hoisted(() => ({
  agent: {
    defaultProviderModel: null as { providerId: string; modelTier: "default" | "haiku" | "sonnet" | "opus" } | null,
  },
}))

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => rendererLogger,
}))

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: appConfig,
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
  appConfig.agent.defaultProviderModel = null
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
    expect(html).toContain("新建对话")
    expect(html).toContain("更多操作")
    expect(html).not.toContain("尚未配置项目")
    expect(html).not.toContain("添加项目后即可开始 Agent 对话")

    const wrapper = document.createElement("div")
    wrapper.innerHTML = html
    const newSessionButton = wrapper.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")
    const actions = newSessionButton?.closest("span")
    expect(actions?.className).toBe("flex shrink-0")
    const groupHeader = actions?.parentElement?.parentElement
    expect(groupHeader?.className).toContain("h-8")
    expect(groupHeader?.className).toContain("pl-2")
    expect(groupHeader?.className).toContain("pr-0.5")
    expect(newSessionButton?.className).toContain("size-7")
    expect(newSessionButton?.dataset.variant).toBe("ghost")
    const moreActionsButton = wrapper.querySelector<HTMLButtonElement>("button[aria-label='更多操作']")
    expect(moreActionsButton?.className).toContain("size-7")
    expect(moreActionsButton?.dataset.variant).toBe("ghost")
  })

  it("lets users edit the generated name before creating a session", async () => {
    vi.spyOn(createSessionName, "formatCreateSessionName").mockReturnValue("新对话 13:30")
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([
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

    await openCustomSessionDialog()

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
      .find((button) => button.textContent === "创建对话")
    await act(async () => {
      confirmButton?.click()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    }, "需求复盘", null)
  })

  it("shows a configured project in the system file manager", async () => {
    const showItemInFolder = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { shell: { showItemInFolder } },
    })
    await renderCreationSidebar(vi.fn())

    await openProjectActionMenu()
    const showInFolderItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "在文件夹中显示")
    expect(showInFolderItem).toBeDefined()

    await act(async () => {
      showInFolderItem?.click()
      await Promise.resolve()
    })

    expect(showItemInFolder).toHaveBeenCalledWith("/tmp/test")
  })

  it("does not offer filesystem actions for the virtual local conversation workspace", async () => {
    await renderCreationSidebar(vi.fn(), DEFAULT_AGENT_WORKSPACE_PROJECT)

    await openProjectActionMenu()

    expect([...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .some((item) => item.textContent === "在文件夹中显示")).toBe(false)
    expect([...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .some((item) => item.textContent === "在终端中打开")).toBe(false)
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

  it("keeps compact session actions right-aligned on the trailing rail", () => {
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

    expect(trailingRail?.className).toContain("w-16")
    expect(trailingRail?.className).toContain("justify-end")
    expect(trailingRail?.className).toContain("tabular-nums")
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

  it("limits delete-others to sessions in the visible source and group", async () => {
    const userSession = {
      projectId: "project-1",
      id: "user-conv",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "User Chat",
      active: true,
      historyCount: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:01:00.000Z",
    }
    const workflowKeep = {
      projectId: "project-1",
      id: "workflow-keep",
      sessionKey: "workflow:run-1",
      platform: "workflow",
      name: "Workflow Keep",
      active: false,
      historyCount: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:02:00.000Z",
    }
    const workflowOther = {
      projectId: "project-1",
      id: "workflow-other",
      sessionKey: "workflow:run-2",
      platform: "workflow",
      name: "Workflow Other",
      active: false,
      historyCount: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:03:00.000Z",
    }
    const onDeleteOthers = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[userSession, workflowKeep, workflowOther]}
          archivedSessions={[]}
          projects={[{ id: "project-1", name: "Project One", path: "/tmp/project-one" }]}
          selectedProjectId="project-1"
          selectedConversationId="workflow-keep"
          sourceFilter="workflow"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={vi.fn()}
          onSourceFilterChange={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={onDeleteOthers}
          onRename={vi.fn()}
        />,
      )
    })

    const keepRow = [...document.querySelectorAll<HTMLElement>('[data-track="agent-session-select"]')]
      .find((row) => row.textContent?.includes("Workflow Keep"))
    expect(keepRow).toBeDefined()

    await act(async () => {
      keepRow!.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }))
      await Promise.resolve()
    })

    const deleteOthersItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "删除其他")
    expect(deleteOthersItem).toBeDefined()

    await act(async () => {
      deleteOthersItem!.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除其他会话？")
    expect(document.body.textContent).toContain("永久删除同组其他 1 个会话")
    expect(onDeleteOthers).not.toHaveBeenCalled()

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "删除")
        ?.click()
      await Promise.resolve()
    })

    expect(onDeleteOthers).toHaveBeenCalledWith(workflowKeep, [workflowKeep, workflowOther])
  })

  it("clears only conversations in the current source and project", async () => {
    const userProjectOne = {
      projectId: "project-1",
      id: "user-project-1",
      sessionKey: "local:renderer",
      platform: "local-renderer",
      name: "User Project One",
      active: false,
      historyCount: 1,
      createdAt: "2026-05-21T00:00:00.000Z",
      updatedAt: "2026-05-21T00:01:00.000Z",
    }
    const workflowProjectOne = {
      ...userProjectOne,
      id: "workflow-project-1",
      sessionKey: "workflow:run-1",
      platform: "workflow",
      name: "Workflow Project One",
    }
    const workflowProjectTwo = {
      ...workflowProjectOne,
      projectId: "project-2",
      id: "workflow-project-2",
      sessionKey: "workflow:run-2",
      name: "Workflow Project Two",
    }
    const onDelete = vi.fn(async () => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <AgentSessionSidebar
          sessions={[userProjectOne, workflowProjectOne, workflowProjectTwo]}
          archivedSessions={[]}
          projects={[
            { id: "project-1", name: "Project One", path: "/tmp/project-one" },
            { id: "project-2", name: "Project Two", path: "/tmp/project-two" },
          ]}
          selectedProjectId="project-1"
          selectedConversationId="workflow-project-1"
          sourceFilter="workflow"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={vi.fn()}
          onSourceFilterChange={vi.fn()}
          onSelect={vi.fn()}
          onDelete={onDelete}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await openProjectActionMenu(0)
    const clearItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "清空对话")
    await act(async () => {
      clearItem?.click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("将删除“工作流”中“Project One”下的 1 个对话")

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "清空对话")
        ?.click()
      await Promise.resolve()
    })

    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith(workflowProjectOne)
    expect(onDelete).not.toHaveBeenCalledWith(userProjectOne)
    expect(onDelete).not.toHaveBeenCalledWith(workflowProjectTwo)
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

  it("defaults to the active provider when creating a session", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([
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
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "openrouter",
      providerName: "OpenRouter",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    }, expect.any(String), null)
    expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull()
  })

  it("prefers the configured default model for quick creation", async () => {
    appConfig.agent.defaultProviderModel = { providerId: "anthropic", modelTier: "sonnet" }
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([
            provider({ id: "anthropic", name: "Anthropic", active: false }),
            provider({ id: "openrouter", name: "OpenRouter", active: true }),
          ]),
        },
      },
    })
    await renderCreationSidebar(onCreateSession)

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    }, expect.any(String), null)
  })

  it("falls back to the custom dialog with the same name when quick creation fails", async () => {
    vi.spyOn(createSessionName, "formatCreateSessionName").mockReturnValue("新对话 14:20")
    const onCreateSession = vi.fn().mockResolvedValue(false)
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([provider()]),
        },
      },
    })
    await renderCreationSidebar(onCreateSession)

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLInputElement>("input[aria-label='会话名称']")?.value)
      .toBe("新对话 14:20")
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
  })

  it("logs rejected quick creation without exposing the raw error", async () => {
    const onCreateSession = vi.fn().mockRejectedValue(new Error("secret create failure"))
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([provider()]),
        },
      },
    })
    await renderCreationSidebar(onCreateSession)

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent quick session creation failed.", {
      boundary: "renderer.agent.session-quick-create",
      projectId: "project-1",
      errorName: "Error",
      errorLength: "secret create failure".length,
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret create failure")
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
  })

  it("opens the custom dialog when no selectable model is available", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([]),
        },
      },
    })
    await renderCreationSidebar(onCreateSession)

    await act(async () => {
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="dialog-content"]')).not.toBeNull()
    expect(document.body.textContent).toContain("暂无 Provider")
  })

  it("prevents duplicate quick creation while provider resolution is pending", async () => {
    let finishLoad: ((providers: SynapseAgentProvider[]) => void) | undefined
    const listAllProviders = vi.fn(() => new Promise<SynapseAgentProvider[]>((resolve) => {
      finishLoad = resolve
    }))
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: { agent: { listAllProviders } },
    })
    await renderCreationSidebar(onCreateSession)

    await act(async () => {
      const button = document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")
      button?.click()
      button?.click()
      await Promise.resolve()
    })

    expect(listAllProviders).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>("button[aria-label='更多操作']")?.disabled).toBe(true)
    expect(document.querySelector("button[aria-label='新建对话'] .animate-spin")).not.toBeNull()

    await act(async () => {
      finishLoad?.([provider()])
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledTimes(1)
  })

  it("opens the custom dialog even when only one provider is available", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockResolvedValue([
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

    await openCustomSessionDialog()

    expect(onCreateSession).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("Anthropic")

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "创建对话")

    await act(async () => {
      confirmButton?.click()
    })

    expect(onCreateSession).toHaveBeenCalledWith("project-1", {
      providerId: "anthropic",
      providerName: "Anthropic",
      modelTier: "sonnet",
      modelName: "claude-sonnet-4-5",
    }, expect.any(String), null)
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
          listAllProviders: vi.fn().mockResolvedValue([
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

    await openCustomSessionDialog()

    const confirmButton = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "创建对话")

    await act(async () => {
      confirmButton?.click()
      await Promise.resolve()
    })

    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("正在创建")
    expect(document.body.textContent).toContain("新建对话")

    await act(async () => {
      finishCreate?.()
      await Promise.resolve()
    })

    expect(document.body.textContent).not.toContain("新建对话")
  })

  it("logs provider list failures without exposing the raw error message", async () => {
    const onCreateSession = vi.fn()
    Object.defineProperty(window, "synapse", {
      configurable: true,
      value: {
        agent: {
          listAllProviders: vi.fn().mockRejectedValue(new Error("secret provider backend failed")),
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
      document.querySelector<HTMLButtonElement>("button[aria-label='新建对话']")?.click()
      await Promise.resolve()
    })

    expect(rendererLogger.warn).toHaveBeenCalledWith("Agent session model list failed.", {
      boundary: "renderer.agent.session-create-model-list",
      errorLength: "secret provider backend failed".length,
      errorName: "Error",
    })
    expect(JSON.stringify(rendererLogger.warn.mock.calls)).not.toContain("secret provider backend failed")
  })

  it("does not create with a stale provider after provider refresh fails", async () => {
    const onCreateSession = vi.fn()
    const listAllProviders = vi.fn()
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
          listAllProviders,
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

    await openCustomSessionDialog(0)
    expect(document.body.textContent).toContain("Anthropic")

    await act(async () => {
      [...document.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "取消")
        ?.click()
    })

    await openCustomSessionDialog(1)

    expect(document.body.textContent).toContain("读取 Provider 失败")
    expect(document.body.textContent).toContain("重试")
    expect(onCreateSession).not.toHaveBeenCalled()
  })
})

async function renderCreationSidebar(
  onCreateSession: ComponentProps<typeof AgentSessionSidebar>["onCreateSession"],
  project = { id: "project-1", name: "Test Project", path: "/tmp/test" },
): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  await act(async () => {
    root.render(
      <AgentSessionSidebar
        sessions={[]}
        archivedSessions={[]}
        projects={[project]}
        selectedProjectId={project.id}
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
}

function provider(overrides: Partial<SynapseAgentProvider> = {}): SynapseAgentProvider {
  return {
    id: "anthropic",
    name: "Anthropic",
    category: "official",
    apiKeyField: "ANTHROPIC_API_KEY",
    active: true,
    model: "claude-sonnet-4-5",
    sonnetModel: "claude-sonnet-4-5",
    createdAt: "2026-05-13T00:00:00.000Z",
    updatedAt: "2026-05-13T00:00:00.000Z",
    ...overrides,
  }
}

async function openCustomSessionDialog(index = 0): Promise<void> {
  await openProjectActionMenu(index)
  const customItem = [...document.querySelectorAll<HTMLElement>("[role='menuitem']")]
    .find((item) => item.textContent === "创建自定义对话")
  expect(customItem).toBeDefined()
  await act(async () => {
    customItem?.click()
    await Promise.resolve()
  })
}

async function openProjectActionMenu(index = 0): Promise<void> {
  await act(async () => {
    const trigger = document.querySelectorAll<HTMLButtonElement>("button[aria-label='更多操作']")[index]
    trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    trigger?.click()
    await Promise.resolve()
  })
}
