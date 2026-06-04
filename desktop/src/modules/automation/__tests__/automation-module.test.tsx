/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { AutomationModule } from "../index"
import { AutomationList } from "../components/automation-list"
import { AutomationListRow } from "../components/automation-list-row"
import { TooltipProvider } from "@/components/ui/tooltip"
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
  runAutomation: vi.fn(),
  stopAutomationRun: vi.fn(),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
      runAutomation: mocks.runAutomation,
      stopAutomationRun: mocks.stopAutomationRun,
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

  it("keeps automation rows from changing background on hover", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AutomationListRow
          item={createItem()}
          projects={[]}
          pending={false}
          running={false}
          onOpen={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
          onHistory={vi.fn()}
          onDelete={vi.fn()}
        />
      </TooltipProvider>,
    )

    const itemClass = html.match(/data-slot="item"[^>]*class="([^"]*)"/)?.[1] ?? ""
    const rowHoverBackgroundClass = itemClass
      .split(/\s+/)
      .find((className) => className.startsWith("hover:bg-"))
    expect(rowHoverBackgroundClass).toBeUndefined()
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

  it("does not render the legacy automation form dialog", async () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })

    expect(document.querySelector('[data-track="automation-form-dialog"]')).toBeNull()
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

  it("allows stopping a running automation without opening the editor", async () => {
    const refresh = vi.fn()
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ activeRun: { status: "running", id: "run-1" } })],
      loading: false,
      error: null,
      refresh,
    })
    mocks.stopAutomationRun.mockResolvedValue({ stopped: true })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    const stopButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "停止运行")
    expect(stopButton).not.toBeNull()
    expect(stopButton?.disabled).toBe(false)

    await act(async () => {
      stopButton?.click()
    })

    expect(mocks.stopAutomationRun).toHaveBeenCalledWith("run-1")
    expect(refresh).toHaveBeenCalled()
    expect(mocks.openEditorWindow).not.toHaveBeenCalled()
  })

  it("keeps the stop action enabled for a running row while other mutations are busy", async () => {
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(
        <TooltipProvider>
          <AutomationListRow
            item={createItem({ activeRun: { status: "running", id: "run-1" } })}
            projects={[]}
            pending={false}
            running={false}
            onOpen={vi.fn()}
            onRun={vi.fn()}
            onStop={vi.fn()}
            onToggleEnabled={vi.fn()}
            onHistory={vi.fn()}
            onDelete={vi.fn()}
          />
        </TooltipProvider>,
      )
    })

    const stopButton = document.querySelector<HTMLButtonElement>('button[aria-label="停止运行"]')
    expect(stopButton).not.toBeNull()
    expect(stopButton?.disabled).toBe(false)
  })

  it("only shows a manual-run spinner on the automation being run", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AutomationList
          items={[
            createItem({ id: "automation:1", name: "Running automation" }),
            createItem({ id: "automation:2", name: "Idle automation" }),
          ]}
          projects={[]}
          createDisabled={false}
          pendingItemIds={new Set()}
          runningItemIds={new Set(["automation:1"])}
          onOpen={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
          onHistory={vi.fn()}
          onDelete={vi.fn()}
          onCreateNew={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html.match(/animate-spin/g)).toHaveLength(1)
  })

  it("keeps idle automation switches enabled while another automation is running", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AutomationList
          items={[
            createItem({ id: "automation:1", name: "Running automation" }),
            createItem({ id: "automation:2", name: "Idle automation" }),
          ]}
          projects={[]}
          createDisabled={false}
          pendingItemIds={new Set()}
          runningItemIds={new Set(["automation:1"])}
          onOpen={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
          onHistory={vi.fn()}
          onDelete={vi.fn()}
          onCreateNew={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html.match(/role="switch"[^>]* disabled=""/g)).toBeNull()
  })

  it("keeps the pending automation switch disabled", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <AutomationList
          items={[
            createItem({ id: "automation:1", name: "Pending automation" }),
            createItem({ id: "automation:2", name: "Idle automation" }),
          ]}
          projects={[]}
          createDisabled={false}
          pendingItemIds={new Set(["automation:1"])}
          runningItemIds={new Set()}
          onOpen={vi.fn()}
          onRun={vi.fn()}
          onStop={vi.fn()}
          onToggleEnabled={vi.fn()}
          onHistory={vi.fn()}
          onDelete={vi.fn()}
          onCreateNew={vi.fn()}
        />
      </TooltipProvider>,
    )

    expect(html.match(/role="switch"[^>]* disabled=""/g)).toHaveLength(1)
  })

  it("treats a cancelled manual run as stopped instead of a mutation failure", async () => {
    const refresh = vi.fn()
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh,
    })
    mocks.runAutomation.mockResolvedValue({
      id: "run-1",
      automationId: "automation:1",
      status: "cancelled",
      triggeredBy: "manual",
      startedAt: "2026-06-03T00:00:00.000Z",
      finishedAt: "2026-06-03T00:00:01.000Z",
      result: { status: "cancelled", summary: "已停止" },
      error: "已停止",
    })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })

    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label") === "运行自动化")
        ?.click()
    })

    expect(mocks.runAutomation).toHaveBeenCalledWith("automation:1")
    expect(refresh).toHaveBeenCalled()
    expect(mocks.rendererLogger.error).not.toHaveBeenCalled()
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
