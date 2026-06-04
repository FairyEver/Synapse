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
          onCreateSession={vi.fn()}
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
          onCreateSession={vi.fn()}
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

  it("tracks Agent project new-session clicks before provider selection", async () => {
    const onCreateSession = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ProjectGroup
          project={{ id: "project-1", name: "Project One", path: "/secret/project-one" }}
          sessions={[]}
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
          onCreateSession={onCreateSession}
          onSelect={vi.fn()}
          onDelete={vi.fn()}
          onDeleteOthers={vi.fn()}
          onRename={vi.fn()}
        />,
      )
    })

    await act(async () => {
      container.querySelector<HTMLButtonElement>('[title="新建会话"]')?.click()
    })

    expect(onCreateSession).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "agent-project-new-session",
      action: "click",
    })
  })
})
