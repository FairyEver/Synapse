/**
 * @vitest-environment jsdom
 */
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProjectGroup } from "../project-group"

const { track } = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ui-tracking")>("@/lib/ui-tracking")
  return {
    ...actual,
    track,
  }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

beforeEach(() => {
  track.mockClear()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("ProjectGroup", () => {
  it("focuses the selected session after deleting a different session", async () => {
    const selectedSession = {
      projectId: "project-1",
      id: "selected-conversation",
      sessionKey: "local:selected-conversation",
      name: "当前会话",
      active: true,
      historyCount: 0,
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:02:00.000Z",
    }
    const deleteSession = {
      ...selectedSession,
      id: "delete-conversation",
      sessionKey: "local:delete-conversation",
      name: "待删会话",
      active: false,
      updatedAt: "2026-06-04T00:01:00.000Z",
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    function Harness() {
      const [sessions, setSessions] = useState([selectedSession, deleteSession])
      return (
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={sessions}
          selectedProjectId="project-1"
          selectedConversationId="selected-conversation"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={vi.fn()}
          onCustomizeSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={(session) => setSessions((current) => current.filter((item) => item.id !== session.id))}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />
      )
    }

    await act(async () => {
      root.render(<Harness />)
    })

    const deleteRow = [...container.querySelectorAll<HTMLElement>('[data-track="agent-session-select"]')]
      .find((row) => row.textContent?.includes("待删会话"))
    await act(async () => {
      deleteRow?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
      await Promise.resolve()
    })
    await act(async () => {
      [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
        .find((item) => item.textContent === "删除")
        ?.click()
      await Promise.resolve()
    })
    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "删除")
        ?.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(document.body.textContent).not.toContain("待删会话")
    expect(document.activeElement).toBe(
      [...container.querySelectorAll<HTMLElement>('[data-track="agent-session-select"]')]
        .find((row) => row.textContent?.includes("当前会话")),
    )
  })

  it("confirms context-menu deletion and restores focus to the session row on cancel", async () => {
    const session = {
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:conversation-1",
      name: "会话标题",
      active: true,
      historyCount: 0,
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:01:00.000Z",
    }
    const onDelete = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={[session]}
          selectedProjectId="project-1"
          selectedConversationId="conversation-1"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={vi.fn()}
          onCustomizeSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={onDelete}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    const row = container.querySelector<HTMLElement>('[data-track="agent-session-select"]')
    await act(async () => {
      row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
      await Promise.resolve()
    })
    await act(async () => {
      [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
        .find((item) => item.textContent === "删除")
        ?.click()
      await Promise.resolve()
    })

    expect(document.body.textContent).toContain("删除会话？")
    expect(document.body.textContent).toContain("此操作无法撤销")
    expect(document.activeElement?.textContent).toBe("取消")
    expect(onDelete).not.toHaveBeenCalled()

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "取消")
        ?.click()
      await new Promise((resolve) => setTimeout(resolve, 60))
    })

    expect(onDelete).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(row)
  })

  it("opens the rename dialog when double-clicking a session row", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={[{
            projectId: "project-1",
            id: "conversation-1",
            sessionKey: "local:conversation-1",
            name: "会话标题",
            active: true,
            historyCount: 1,
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:01:00.000Z",
          }]}
          selectedProjectId="project-1"
          selectedConversationId="conversation-1"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={vi.fn()}
          onCustomizeSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[data-track="agent-session-select"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })

    const input = document.body.querySelector<HTMLInputElement>("input")
    expect(document.body.textContent).toContain("重命名会话")
    expect(input?.value).toBe("会话标题")
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe("会话标题".length)

    await act(async () => {
      const cancelButton = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "取消")
      cancelButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })

    expect(document.activeElement).toBe(
      container.querySelector('[data-track="agent-session-select"]'),
    )
  })

  it("does not open the rename dialog when double-clicking the delete button", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={[{
            projectId: "project-1",
            id: "conversation-1",
            sessionKey: "local:conversation-1",
            name: "会话标题",
            active: true,
            historyCount: 1,
            createdAt: "2026-06-04T00:00:00.000Z",
            updatedAt: "2026-06-04T00:01:00.000Z",
          }]}
          selectedProjectId="project-1"
          selectedConversationId="conversation-1"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={vi.fn()}
          onCustomizeSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLElement>('[title="删除会话"]')
        ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    })

    expect(document.body.textContent).not.toContain("重命名会话")
  })

  it("renders tracked actions for quick creation, custom creation, folder reveal, and Terminal", async () => {
    const onQuickCreateSession = vi.fn()
    const onCustomizeSession = vi.fn()
    const onShowProjectInFolder = vi.fn()
    const onOpenProjectInTerminal = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={[]}
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={onQuickCreateSession}
          onCustomizeSession={onCustomizeSession}
          onShowProjectInFolder={onShowProjectInFolder}
          onOpenProjectInTerminal={onOpenProjectInTerminal}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="新建对话"]')?.click()
    })

    expect(onQuickCreateSession).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-project-new-session",
      action: "click",
    })

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
      await Promise.resolve()
    })
    const customItem = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "创建自定义对话")
    expect(customItem).toBeDefined()
    expect([...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .map((item) => item.textContent)).toEqual([
      "创建自定义对话",
      "在文件夹中显示",
      "在终端中打开",
      "清空对话",
    ])

    await act(async () => {
      customItem?.click()
    })

    expect(onCustomizeSession).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "dropdown-menu-item",
      name: "agent-project-custom-new-session",
      action: "select",
    })

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
      await Promise.resolve()
    })
    const showInFolderItem = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "在文件夹中显示")
    expect(showInFolderItem).toBeDefined()

    await act(async () => {
      showInFolderItem?.click()
    })

    expect(onShowProjectInFolder).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "dropdown-menu-item",
      name: "agent-project-show-in-folder",
      action: "select",
    })

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
      await Promise.resolve()
    })
    const terminalItem = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "在终端中打开")
    expect(terminalItem).toBeDefined()

    await act(async () => {
      terminalItem?.click()
    })

    expect(onOpenProjectInTerminal).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "dropdown-menu-item",
      name: "agent-project-open-terminal",
      action: "select",
    })
    expect(document.querySelector('[data-slot="dropdown-menu-separator"]')).toBeNull()
  })

  it("confirms before clearing every conversation supplied by the visible category", async () => {
    const sessions = [{
      projectId: "project-1",
      id: "conversation-1",
      sessionKey: "local:conversation-1",
      name: "对话一",
      active: true,
      historyCount: 1,
      createdAt: "2026-06-04T00:00:00.000Z",
      updatedAt: "2026-06-04T00:01:00.000Z",
    }, {
      projectId: "project-1",
      id: "conversation-2",
      sessionKey: "local:conversation-2",
      name: "对话二",
      active: false,
      historyCount: 1,
      createdAt: "2026-06-04T00:02:00.000Z",
      updatedAt: "2026-06-04T00:03:00.000Z",
    }]
    const onDelete = vi.fn(async () => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sourceLabel="用户对话"
          sessions={sessions}
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onQuickCreateSession={vi.fn()}
          onCustomizeSession={vi.fn()}
          onSelect={vi.fn()}
          onDelete={onDelete}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
      await Promise.resolve()
    })
    const clearItem = [...document.body.querySelectorAll<HTMLElement>("[role='menuitem']")]
      .find((item) => item.textContent === "清空对话")
    expect(clearItem?.getAttribute("data-variant")).toBe("destructive")

    await act(async () => {
      clearItem?.click()
      await Promise.resolve()
    })
    expect(document.body.textContent).toContain("将删除“用户对话”中“Project One”下的 2 个对话")
    expect(onDelete).not.toHaveBeenCalled()

    await act(async () => {
      [...document.body.querySelectorAll<HTMLButtonElement>("button")]
        .find((button) => button.textContent === "清空对话")
        ?.click()
      await Promise.resolve()
    })

    expect(onDelete).toHaveBeenCalledTimes(2)
    expect(onDelete).toHaveBeenCalledWith(sessions[0])
    expect(onDelete).toHaveBeenCalledWith(sessions[1])
    expect(track).toHaveBeenCalledWith({
      component: "dropdown-menu-item",
      name: "agent-project-clear-sessions",
      action: "select",
    })
  })
})
