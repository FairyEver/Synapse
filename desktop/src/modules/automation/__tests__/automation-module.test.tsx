/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AutomationModule } from "../index"
import type { AutomationItem } from "@/types/automation"

const mocks = vi.hoisted(() => ({
  rendererLogger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
  useAutomationItems: vi.fn(),
  openCreateEditorWindow: vi.fn(),
  openEditorWindow: vi.fn(),
}))

globalThis.IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/app-shell/logging", () => ({
  createRendererLogger: () => mocks.rendererLogger,
}))

vi.mock("@/lib/electron-bridge", async () => {
  const actual = await vi.importActual<typeof import("@/lib/electron-bridge")>(
    "@/lib/electron-bridge",
  )
  return {
    ...actual,
    requireBridgeDomain: () => ({
      openCreateEditorWindow: mocks.openCreateEditorWindow,
      openEditorWindow: mocks.openEditorWindow,
    }),
  }
})

vi.mock("@/app-shell/config", () => ({
  useAppConfig: () => ({
    config: {
      global: {
        projects: [
          {
            id: "project-1",
            name: "Synapse",
            path: "/Users/liyang/Documents/code/github/Synapse",
          },
        ],
      },
    },
  }),
}))

vi.mock("@/app-shell/notifications", () => ({
  useAppNotifications: () => ({
    promise: async <T,>(operation: () => Promise<T>) => operation(),
  }),
}))

vi.mock("../hooks/use-automation", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-automation")>(
    "../hooks/use-automation",
  )
  return {
    ...actual,
    useAutomationItems: mocks.useAutomationItems,
  }
})

afterEach(() => {
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

describe("AutomationModule", () => {
  it("renders empty state when there are no automations", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<AutomationModule />)

    expect(html).toContain("暂无自动化")
  })

  it("renders automation names and trigger info in list rows", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ name: "日报自动化" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<AutomationModule />)

    expect(html).toContain("日报自动化")
    expect(html).toContain("每 10 分钟")
    expect(html).toContain('data-slot="item"')
  })

  it("uses the workflow-style scroll container", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<AutomationModule />)

    expect(html).toContain('data-slot="scroll-area"')
    expect(html).toContain("min-h-full")
  })

  it("opens the create editor window from the header action", async () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    mocks.openCreateEditorWindow.mockResolvedValue(undefined)
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "新建")?.click()
    })

    expect(mocks.openCreateEditorWindow).toHaveBeenCalledTimes(1)
  })

  it("opens the editor window from a list row", async () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    mocks.openEditorWindow.mockResolvedValue(undefined)
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    await act(async () => {
      document.querySelector<HTMLElement>('[data-slot="item"]')?.click()
    })

    expect(mocks.openEditorWindow).toHaveBeenCalledWith("automation:1")
  })
})

function createItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    id: "automation:1",
    schemaVersion: 1,
    name: "Daily report",
    description: "Daily summary",
    enabled: true,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 10, anchor: "created_at", activeDays: [0, 1, 2, 3, 4, 5, 6] },
    },
    executor: {
      type: "builtin.command",
      config: { command: "echo ok", shell: "posix", timeoutMins: 30 },
    },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
    createdAt: "2026-06-03T00:00:00.000Z",
    updatedAt: "2026-06-03T00:00:00.000Z",
    runCount: 0,
    configVersion: 0,
    ...overrides,
  }
}
