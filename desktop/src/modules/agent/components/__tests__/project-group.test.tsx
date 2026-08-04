/**
 * @vitest-environment jsdom
 */
import { act } from "react"
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

  it("renders tracked actions for quick creation, custom creation, and showing the project folder", async () => {
    const onQuickCreateSession = vi.fn()
    const onCustomizeSession = vi.fn()
    const onShowProjectInFolder = vi.fn()
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
      .find((item) => item.textContent === "自定义对话")
    expect(customItem).toBeDefined()

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
