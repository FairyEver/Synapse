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
import { AutomationRunsDialog } from "../components/automation-runs-dialog"
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
  notificationError: vi.fn(),
  deleteAutomation: vi.fn(),
  runAutomation: vi.fn(),
  stopAutomationRun: vi.fn(),
  listAutomationRuns: vi.fn(),
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
      editor: {
        openCreate: mocks.openCreateEditorWindow,
        openEdit: mocks.openEditorWindow,
      },
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
    promise: async <T,>(
      operation: () => Promise<T>,
      messages: {
        error?: unknown | ((error: unknown) => unknown)
      },
    ) => {
      try {
        return await operation()
      } catch (error) {
        const resolved = typeof messages.error === "function"
          ? messages.error(error)
          : messages.error

        if (
          resolved
          && typeof resolved === "object"
          && "message" in resolved
          && resolved.message !== null
        ) {
          mocks.notificationError(resolved.message)
        } else if (resolved !== null && resolved !== undefined) {
          mocks.notificationError(resolved)
        }

        throw error
      }
    },
  }),
}))

vi.mock("../hooks/use-automation", async () => {
  const actual = await vi.importActual<typeof import("../hooks/use-automation")>(
    "../hooks/use-automation",
  )
    return {
      ...actual,
      useAutomationItems: mocks.useAutomationItems,
      deleteAutomation: mocks.deleteAutomation,
      listAutomationRuns: mocks.listAutomationRuns,
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

  it("renders automation names and trigger and executor types in list rows", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ name: "日报自动化" })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<AutomationModule />)

    expect(html).toContain("日报自动化")
    expect(html).toContain("触发器 固定间隔")
    expect(html).toContain("执行器 命令")
    expect(html).not.toContain("每 10 分钟")
    expect(html).not.toContain("echo ok")
    expect(html).toContain('data-slot="table"')
    expect(html).toContain("下次运行")
  })

  it("does not force a horizontal minimum width for the automation list", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })

    const html = renderToStaticMarkup(<AutomationModule />)

    expect(html).not.toContain("min-w-[52rem]")
  })

  it("renders automation rows as compact table rows", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <table>
          <tbody>
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
          </tbody>
        </table>
      </TooltipProvider>,
    )

    expect(html).toContain('data-slot="table-row"')
    expect(html).toContain('data-slot="table-cell"')
    expect(html).toContain("已启用")
    expect(html).toContain('class="truncate text-xs text-muted-foreground"')
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

  it("shows a retry action without the empty state when run history loading fails", async () => {
    mocks.listAutomationRuns
      .mockRejectedValueOnce(new Error("network failed"))
      .mockResolvedValueOnce([])
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(
        <AutomationRunsDialog
          busy={false}
          item={createItem()}
          open
          onOpenChange={vi.fn()}
          onStopRun={vi.fn()}
        />,
      )
    })
    await flushPromises()

    expect(document.body.textContent).toContain("读取历史失败")
    expect(document.body.textContent).toContain("重试")
    expect(document.body.textContent).not.toContain("暂无运行记录")

    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "重试")
        ?.click()
    })
    await flushPromises()

    expect(mocks.listAutomationRuns).toHaveBeenCalledTimes(2)
    expect(document.body.textContent).not.toContain("读取历史失败")
    expect(document.body.textContent).toContain("暂无运行记录")
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
      document.querySelector<HTMLElement>('tbody tr[data-slot="table-row"]')?.click()
    })

    expect(mocks.openEditorWindow).toHaveBeenCalledWith("automation:1")
  })

  it("opens the editor window from the explicit row edit action", async () => {
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
    const editButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "编辑自动化 Daily report")
    expect(editButton).not.toBeNull()

    await act(async () => {
      editButton?.click()
    })

    expect(mocks.openEditorWindow).toHaveBeenCalledTimes(1)
    expect(mocks.openEditorWindow).toHaveBeenCalledWith("automation:1")
  })

  it("opens delete confirmation normally and deletes immediately on Alt-click", async () => {
    const refresh = vi.fn()
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh,
    })
    mocks.deleteAutomation.mockResolvedValue({ deleted: true })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })

    const deleteButton = () => document.querySelector<HTMLButtonElement>('button[aria-label="删除自动化"]')

    await act(async () => {
      deleteButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(document.body.textContent).toContain("删除自动化")
    expect(mocks.deleteAutomation).not.toHaveBeenCalled()

    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    await act(async () => {
      deleteButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }))
    })

    expect(mocks.deleteAutomation).toHaveBeenCalledWith("automation:1")
    expect(refresh).toHaveBeenCalled()
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

  it("treats an already finished stale active run as a successful stop", async () => {
    const refresh = vi.fn()
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ activeRun: { status: "running", id: "run-1" } })],
      loading: false,
      error: null,
      refresh,
    })
    mocks.stopAutomationRun.mockResolvedValue({ stopped: false, alreadyFinished: true })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    const stopButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "停止运行")

    await act(async () => {
      stopButton?.click()
    })

    expect(mocks.stopAutomationRun).toHaveBeenCalledWith("run-1")
    expect(refresh).toHaveBeenCalled()
    expect(mocks.rendererLogger.warn).not.toHaveBeenCalled()
  })

  it("treats an unconfirmed stop request as accepted", async () => {
    const refresh = vi.fn()
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ activeRun: { status: "running", id: "run-1" } })],
      loading: false,
      error: null,
      refresh,
    })
    mocks.stopAutomationRun.mockResolvedValue({ stopped: false, stopRequested: true })
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    const stopButton = Array.from(document.querySelectorAll("button"))
      .find((button) => button.getAttribute("aria-label") === "停止运行")

    await act(async () => {
      stopButton?.click()
    })

    expect(mocks.stopAutomationRun).toHaveBeenCalledWith("run-1")
    expect(refresh).toHaveBeenCalled()
    expect(mocks.rendererLogger.warn).not.toHaveBeenCalled()
  })

  it("keeps the stop action enabled for a running row while other mutations are busy", async () => {
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(
        <TooltipProvider>
          <table>
            <tbody>
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
            </tbody>
          </table>
        </TooltipProvider>,
      )
    })

    const stopButton = document.querySelector<HTMLButtonElement>('button[aria-label="停止运行"]')
    expect(stopButton).not.toBeNull()
    expect(stopButton?.disabled).toBe(false)
  })

  it("disables manual run for automations that need updates", async () => {
    const onRun = vi.fn()
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(
        <TooltipProvider>
          <table>
            <tbody>
              <AutomationListRow
                item={createItem({
                  validation: {
                    status: "needs_update",
                    issues: [{ field: "trigger.config", message: "检查触发器" }],
                  },
                })}
                projects={[]}
                pending={false}
                running={false}
                onOpen={vi.fn()}
                onRun={onRun}
                onStop={vi.fn()}
                onToggleEnabled={vi.fn()}
                onHistory={vi.fn()}
                onDelete={vi.fn()}
              />
            </tbody>
          </table>
        </TooltipProvider>,
      )
    })

    const runButton = document.querySelector<HTMLButtonElement>('button[aria-label="需要更新后才能运行自动化"]')
    expect(runButton).not.toBeNull()
    expect(runButton?.disabled).toBe(true)

    await act(async () => {
      runButton?.click()
    })

    expect(onRun).not.toHaveBeenCalled()
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

  it("shows an already-running message when a manual run is skipped by overlap policy", async () => {
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
      status: "skipped",
      triggeredBy: "manual",
      startedAt: "2026-06-03T00:00:00.000Z",
      finishedAt: "2026-06-03T00:00:00.000Z",
      error: "automation is already running",
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
    expect(mocks.notificationError).toHaveBeenCalledWith("自动化正在运行中")
    expect(mocks.notificationError).not.toHaveBeenCalledWith("运行自动化失败。")
    expect(refresh).toHaveBeenCalled()
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

async function flushPromises() {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}
