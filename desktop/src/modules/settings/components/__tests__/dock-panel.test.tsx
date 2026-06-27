/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { SynapseSystemAppManifest } from "@/modules/apps/types"

const apps = {
  agent: {
    id: "agent",
    name: "对话",
    icon: "/agent.png",
  },
  launcher: {
    id: "launcher",
    name: "应用",
    icon: "/launcher.png",
  },
  database: {
    id: "database",
    name: "本地数据库",
    icon: "/database.png",
  },
} as const

const mocks = vi.hoisted(() => ({
  addDockApp: vi.fn(),
  moveDockApp: vi.fn(),
  removeDockApp: vi.fn(),
  restoreDefaultDock: vi.fn(),
  saving: false,
}))

vi.mock("@/modules/apps/hooks/use-dock-preferences", () => ({
  useDockPreferences: () => ({
    addableApps: [apps.database],
    addDockApp: mocks.addDockApp,
    dockAppIds: ["agent", "launcher"],
    moveDockApp: mocks.moveDockApp,
    pinnedApps: [apps.agent, apps.launcher],
    removeDockApp: mocks.removeDockApp,
    reorderDockApps: vi.fn(),
    restoreDefaultDock: mocks.restoreDefaultDock,
    saving: mocks.saving,
  }),
}))

import { DockPanel } from "../dock-panel"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

async function renderDockPanel() {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<DockPanel workflowEntryVisible={false} />)
  })

  return container
}

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  mocks.saving = false
  vi.clearAllMocks()
})

describe("DockPanel", () => {
  it("renders pinned and addable app lists", async () => {
    const container = await renderDockPanel()

    expect(container.textContent).toContain("已固定")
    expect(container.textContent).toContain("可添加")
    expect(container.textContent).toContain("对话")
    expect(container.textContent).toContain("应用")
    expect(container.textContent).toContain("本地数据库")
  })

  it("calls add, remove, move, and restore actions", async () => {
    await renderDockPanel()

    await act(async () => {
      findButtonByText("添加").click()
      findButtonByText("移除").click()
      findButtonByLabel("下移 对话").click()
      findButtonByLabel("上移 应用").click()
      findButtonByText("恢复默认").click()
    })

    expect(mocks.addDockApp).toHaveBeenCalledWith("database")
    expect(mocks.removeDockApp).toHaveBeenCalledWith("agent")
    expect(mocks.moveDockApp).toHaveBeenCalledWith("agent", "down")
    expect(mocks.moveDockApp).toHaveBeenCalledWith("launcher", "up")
    expect(mocks.restoreDefaultDock).toHaveBeenCalledTimes(1)
  })

  it("does not render remove for launcher and disables controls while saving", async () => {
    mocks.saving = true
    const container = await renderDockPanel()

    const removeButtons = Array.from(container.querySelectorAll("button"))
      .filter((button) => button.textContent?.includes("移除"))
    expect(removeButtons).toHaveLength(1)
    expect(removeButtons[0]?.closest("[data-dock-app-id]")?.getAttribute("data-dock-app-id")).toBe("agent")
    expect(Array.from(container.querySelectorAll("button")).every((button) => button.disabled)).toBe(true)
  })
})

function findButtonByText(text: string): HTMLButtonElement {
  const button = Array.from(document.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${text}`)
  }

  return button
}

function findButtonByLabel(label: string): HTMLButtonElement {
  const button = document.querySelector(`button[aria-label='${label}']`)

  if (!(button instanceof HTMLButtonElement)) {
    throw new Error(`Button not found: ${label}`)
  }

  return button
}
