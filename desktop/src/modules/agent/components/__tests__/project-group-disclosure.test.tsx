/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { SynapseAgentSessionSummary } from "@/types/agent"
import { conversationUnreadKey } from "../../live-sync"
import { ProjectGroup } from "../project-group"

vi.mock("@/lib/ui-tracking", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ui-tracking")>("@/lib/ui-tracking")
  return { ...actual, track: vi.fn() }
})

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const sessions: SynapseAgentSessionSummary[] = Array.from({ length: 32 }, (_, index) => ({
  projectId: "project-1",
  id: `conversation-${index + 1}`,
  sessionKey: `local:conversation-${index + 1}`,
  name: `对话 ${index + 1}`,
  active: index === 0,
  historyCount: 1,
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: `2026-10-11T00:${String(32 - index).padStart(2, "0")}:00.000Z`,
}))

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) act(() => root.unmount())
  roots = []
  document.body.innerHTML = ""
})

async function renderGroup(overrides: Partial<ComponentProps<typeof ProjectGroup>> = {}) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)
  const props: ComponentProps<typeof ProjectGroup> = {
    project: { id: "project-1", name: "Project One", path: "/tmp/project-one" },
    sourceLabel: "用户对话",
    sessions,
    unreadByConversationId: {},
    sendingConversationIds: new Set(),
    onQuickCreateSession: vi.fn(),
    onQuickCreateTerminalSession: vi.fn(),
    onCustomizeSession: vi.fn(),
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onDeleteOthers: vi.fn(),
    onRename: vi.fn(),
    ...overrides,
  }

  async function render(nextProps: Partial<ComponentProps<typeof ProjectGroup>> = {}) {
    Object.assign(props, nextProps)
    await act(async () => root.render(<ProjectGroup {...props} />))
  }

  await render()
  return { container, render }
}

function sessionRows(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('[data-track="agent-session-select"]')]
}

function disclosureButton(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => button.textContent?.startsWith("展开其他（") || button.textContent === "收起") ?? null
}

async function click(element: HTMLElement | null | undefined) {
  expect(element).toBeTruthy()
  await act(async () => element?.click())
}

describe("ProjectGroup history disclosure", () => {
  it("limits a project with dozens of conversations to its five recent rows", async () => {
    const { container } = await renderGroup()

    expect(sessionRows(container).map((row) => row.querySelector(".truncate")?.textContent)).toEqual([
      "对话 1",
      "对话 2",
      "对话 3",
      "对话 4",
      "对话 5",
    ])
    expect(disclosureButton(container)?.textContent).toBe("展开其他（27）")
    expect(disclosureButton(container)?.getAttribute("aria-expanded")).toBe("false")
  })

  it.each([0, 5])("omits the history control when the project has %i conversations", async (count) => {
    const { container } = await renderGroup({ sessions: sessions.slice(0, count) })

    expect(sessionRows(container)).toHaveLength(count)
    expect(disclosureButton(container)).toBeNull()
  })

  it("expands all history at once and collapses it without selecting another conversation", async () => {
    const onSelect = vi.fn()
    const { container } = await renderGroup({
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-1",
      onSelect,
    })

    await click(disclosureButton(container))

    expect(sessionRows(container)).toHaveLength(32)
    expect(disclosureButton(container)?.textContent).toBe("收起")
    expect(disclosureButton(container)?.getAttribute("aria-expanded")).toBe("true")

    disclosureButton(container)?.focus()
    await click(disclosureButton(container))

    expect(sessionRows(container)).toHaveLength(5)
    expect(document.activeElement).toBe(disclosureButton(container))
    expect(container.querySelector('[aria-current="page"]')?.textContent).toContain("对话 1")
    expect(onSelect).not.toHaveBeenCalled()
  })

  it("keeps an older selected conversation as a sixth row and excludes it from hidden counts", async () => {
    const { container } = await renderGroup({
      selectedProjectId: "project-1",
      selectedConversationId: "conversation-32",
    })
    const selectedRow = container.querySelector('[aria-current="page"]')

    expect(sessionRows(container)).toHaveLength(6)
    expect(selectedRow?.textContent).toContain("对话 32")
    expect(disclosureButton(container)?.textContent).toBe("展开其他（26）")

    await click(disclosureButton(container))
    await click(disclosureButton(container))

    expect(sessionRows(container)).toHaveLength(6)
    expect(container.querySelector('[aria-current="page"]')).toBe(selectedRow)
  })

  it("returns to recent conversations after closing and reopening the project", async () => {
    const { container } = await renderGroup()
    await click(disclosureButton(container))
    expect(sessionRows(container)).toHaveLength(32)

    const projectTrigger = container.querySelector<HTMLButtonElement>(
      '[data-slot="collapsible-trigger"]',
    )
    await click(projectTrigger)
    await click(projectTrigger)

    expect(sessionRows(container)).toHaveLength(5)
    expect(disclosureButton(container)?.textContent).toBe("展开其他（27）")
  })

  it("surfaces hidden running and unread conversations without expanding the list", async () => {
    const { container, render } = await renderGroup({
      unreadByConversationId: { [conversationUnreadKey("project-1", "conversation-6")]: 2 },
      sendingConversationIds: new Set(["conversation-7"]),
    })

    expect(sessionRows(container)).toHaveLength(5)
    expect(disclosureButton(container)?.querySelector('[aria-label="正在输出"]')).toBeTruthy()
    expect(disclosureButton(container)?.querySelector('[aria-label="未读"]')).toBeNull()

    await render({ sendingConversationIds: new Set() })

    expect(disclosureButton(container)?.querySelector('[aria-label="未读"]')).toBeTruthy()

    await click(disclosureButton(container))
    expect(disclosureButton(container)?.querySelector('[aria-label="未读"]')).toBeNull()
  })

  it("replaces the fifth recent row when a newly created conversation is selected", async () => {
    const { container, render } = await renderGroup()
    const created: SynapseAgentSessionSummary = {
      ...sessions[0],
      id: "created-conversation",
      sessionKey: "local:created-conversation",
      name: "新建对话",
      updatedAt: "2026-10-11T01:00:00.000Z",
    }
    await render({
      sessions: [created, ...sessions],
      selectedProjectId: "project-1",
      selectedConversationId: created.id,
    })

    expect(sessionRows(container)).toHaveLength(5)
    expect(sessionRows(container)[0]?.getAttribute("aria-current")).toBe("page")
    expect(sessionRows(container)[0]?.textContent).toContain("新建对话")
    expect(sessionRows(container).some((row) => row.textContent?.includes("对话 5"))).toBe(false)
    expect(disclosureButton(container)?.textContent).toBe("展开其他（28）")
  })

  it("moves an updated historical conversation into the recent list even when upstream order is unchanged", async () => {
    const { container, render } = await renderGroup()
    await click(disclosureButton(container))

    await render({
      sessions: sessions.map((session) => session.id === "conversation-8"
        ? { ...session, name: "历史对话重命名", updatedAt: "2026-10-11T02:00:00.000Z" }
        : session),
    })
    expect(sessionRows(container)[0]?.textContent).toContain("历史对话重命名")

    await click(disclosureButton(container))

    expect(sessionRows(container)).toHaveLength(5)
    expect(sessionRows(container)[0]?.textContent).toContain("历史对话重命名")
    expect(sessionRows(container).some((row) => row.textContent?.includes("对话 5"))).toBe(false)
    expect(disclosureButton(container)?.textContent).toBe("展开其他（27）")
  })

  it("clears the complete source-filtered project rather than only its recent rows", async () => {
    const onDelete = vi.fn()
    const { container } = await renderGroup({ onDelete })
    expect(sessionRows(container)).toHaveLength(5)

    await act(async () => {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-label="更多操作"]')
      trigger?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
      trigger?.click()
    })
    await click([...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "清空对话"))

    expect(document.body.textContent).toContain("下的 32 个对话")
    await click([...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "清空对话"))

    expect(onDelete).toHaveBeenCalledTimes(32)
    expect(onDelete).toHaveBeenCalledWith(sessions[31])
  })

  it("passes hidden history to the confirmed delete-others action", async () => {
    const onDeleteOthers = vi.fn()
    const { container } = await renderGroup({ onDeleteOthers })
    expect(sessionRows(container)).toHaveLength(5)

    await act(async () => {
      sessionRows(container)[0]?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, button: 2 }))
    })
    await click([...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')]
      .find((item) => item.textContent === "删除其他"))

    expect(document.body.textContent).toContain("同组其他 31 个会话")
    await click([...document.body.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "删除"))

    expect(onDeleteOthers).toHaveBeenCalledWith(sessions[0], sessions)
  })
})
