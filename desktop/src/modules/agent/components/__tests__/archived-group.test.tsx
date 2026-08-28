/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { ArchivedGroup } from "../archived-group"

const archivedSession: SynapseAgentSessionSummary = {
  projectId: "project-1",
  id: "archived-conv",
  sessionKey: "local:archived-conv",
  name: "Archived Claude Session",
  active: false,
  historyCount: 3,
  createdAt: "2026-05-14T00:00:00.000Z",
  updatedAt: "2026-05-14T01:00:00.000Z",
}

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
})

describe("ArchivedGroup", () => {
  it("confirms context-menu deletion before removing an archived session", async () => {
    const onDelete = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ArchivedGroup
          sessions={[archivedSession]}
          selectedProjectId="project-1"
          selectedConversationId="archived-conv"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
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
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("opens when the selected Agent session is archived", () => {
    const html = renderToStaticMarkup(
      <ArchivedGroup
        sessions={[archivedSession]}
        selectedProjectId="project-1"
        selectedConversationId="archived-conv"
        unreadByConversationId={{}}
        sendingConversationIds={new Set()}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        onDeleteOthers={vi.fn()}
        onRename={vi.fn()}
      />,
    )

    expect(html).toContain('data-state="open"')
    expect(html).toContain("Archived Claude Session")
  })

  it("opens the rename dialog when double-clicking an archived session row", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ArchivedGroup
          sessions={[archivedSession]}
          selectedProjectId="project-1"
          selectedConversationId="archived-conv"
          unreadByConversationId={{}}
          sendingConversationIds={new Set()}
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
    expect(input?.value).toBe("Archived Claude Session")
    expect(input?.selectionStart).toBe(0)
    expect(input?.selectionEnd).toBe("Archived Claude Session".length)

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
})
