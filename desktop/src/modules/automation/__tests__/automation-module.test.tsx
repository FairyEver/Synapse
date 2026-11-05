/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot as createReactRoot, type Root } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, describe, expect, it, vi } from "vitest"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { AutomationModule } from "../index"
import { runAppNavigation } from "@/app-shell/navigation-guard"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { AutomationList } from "../components/automation-list"
import { AutomationListRow } from "../components/automation-list-row"
import { AutomationCard } from "../components/automation-card"
import { AutomationRunsPanel } from "../components/automation-runs-dialog"
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
  itemCreate: vi.fn(),
  deleteAutomation: vi.fn(),
  runAutomation: vi.fn(),
  stopAutomationRun: vi.fn(),
  setAutomationEnabled: vi.fn(),
  listAutomationRuns: vi.fn(),
}))

const roots = new Set<Root>()

function createRoot(container: Element) {
  const root = createReactRoot(container)
  roots.add(root)
  return root
}

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

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
      item: {
        list: async () => [],
        get: async () => createItem(),
        create: mocks.itemCreate,
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
      setAutomationEnabled: mocks.setAutomationEnabled,
    }
  })

afterEach(async () => {
  await act(async () => {
    roots.forEach((root) => root.unmount())
  })
  roots.clear()
  vi.clearAllMocks()
  document.body.innerHTML = ""
})

describe("AutomationModule", () => {
  it.each(["success", "failed", "moved"] as const)("restores focus after an Alt-delete %s without stealing a moved focus", async (scenario) => {
    let items = [createItem()]
    mocks.useAutomationItems.mockImplementation(() => ({ items, loading: false, error: null, refresh: vi.fn() }))
    let settle!: () => void
    mocks.deleteAutomation.mockImplementation(() => new Promise((resolve, reject) => {
      settle = () => {
        if (scenario === "failed") reject(new Error("test delete failure"))
        else { items = []; resolve({ deleted: true }) }
      }
    }))
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<AutomationModule />))
    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索自动化"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "Daily")
      search.dispatchEvent(new Event("input", { bubbles: true }))
    })
    const button = document.querySelector<HTMLButtonElement>('[aria-label="删除自动化"]')!
    await act(async () => button.focus())
    await act(async () => { button.dispatchEvent(new MouseEvent("click", { bubbles: true, altKey: true })) })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(button.disabled).toBe(true)
    // Model the browser blurring the pending disabled button.
    await act(async () => {
      container.tabIndex = -1
      container.focus()
      container.blur()
      if (scenario === "moved") search.focus()
    })
    await act(async () => settle())
    const create = [...document.querySelectorAll("button")].find(candidate => candidate.textContent === "新建")
    expect(document.activeElement).toBe(scenario === "moved" ? search : scenario === "failed" ? button : create)
    if (scenario !== "failed") expect(document.body.textContent).toContain("没有匹配的自动化")
  })

  it("returns focus to search when clearing filters", async () => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ enabled: false })], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<AutomationModule />))
    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索自动化"]')!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "no-match")
      search.dispatchEvent(new Event("input", { bubbles: true }))
      const enabledTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === "已启用")!
      enabledTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }))
    })
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("已启用")
    const clear = [...document.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "清除筛选")!
    clear.focus()
    await act(async () => clear.click())
    expect(search.value).toBe("")
    expect(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("全部")
    expect(document.body.textContent).toContain("Daily report")
    expect(document.activeElement).toBe(search)
  })

  it.each(["visible", "filtered", "failed", "moved"] as const)("restores toggle focus after %s completion without stealing a moved focus", async (scenario) => {
    let current = createItem({ enabled: scenario === "filtered" })
    mocks.useAutomationItems.mockImplementation(() => ({ items: [current], loading: false, error: null, refresh: vi.fn() }))
    let settle!: () => void
    mocks.setAutomationEnabled.mockImplementation(() => new Promise<AutomationItem>((resolve, reject) => {
      settle = () => {
        if (scenario === "failed") reject(new Error("test offline"))
        else { current = { ...current, enabled: !current.enabled }; resolve(current) }
      }
    }))
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<AutomationModule />))
    if (scenario === "filtered") {
      const enabledTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(tab => tab.textContent === "已启用")!
      await act(async () => { enabledTab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })) })
      expect(enabledTab.getAttribute("aria-selected")).toBe("true")
    }
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    const search = document.querySelector<HTMLInputElement>('[aria-label="搜索自动化"]')!
    toggle.focus()
    await act(async () => toggle.click())
    expect(toggle.disabled).toBe(true)
    // Model browser focus fixup; jsdom otherwise leaves the disabled switch focused.
    container.tabIndex = -1
    container.focus()
    container.blur()
    expect(document.activeElement).toBe(document.body)
    if (scenario === "moved") search.focus()
    await act(async () => settle())
    expect(document.activeElement).toBe(scenario === "filtered" || scenario === "moved" ? search : toggle)
    if (scenario === "filtered") expect(document.body.textContent).toContain("没有匹配的自动化")
  })

  it.each([
    { enabled: false, error: new Error("邮箱已暂停，请先恢复同步"), expected: "邮箱已暂停，请先恢复同步" },
    { enabled: false, error: new Error("Error invoking remote method 'synapse:automation:item:setEnabled': Error: 邮箱已暂停，请先恢复同步"), expected: "邮箱已暂停，请先恢复同步" },
    { enabled: true, error: new Error("无法确认停用边界，请恢复连接后重试"), expected: "无法确认停用边界，请恢复连接后重试" },
    { enabled: false, error: new Error("  "), expected: "启用自动化失败。" },
    { enabled: true, error: null, expected: "停用自动化失败。" },
    { enabled: false, error: new Error("连接失败 token=private-test-value /Users/test/private.txt"), expected: "连接失败 token=[redacted] [path]" },
  ])("shows the actionable, sanitized toggle failure ($enabled, $expected)", async ({ enabled, error, expected }) => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ enabled })], loading: false, error: null, refresh: vi.fn() })
    mocks.setAutomationEnabled.mockRejectedValueOnce(error)
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<AutomationModule />))
    const toggle = document.querySelector<HTMLButtonElement>('[role="switch"]')!
    await act(async () => toggle.click())
    expect(mocks.notificationError).toHaveBeenCalledWith(expected)
    expect(toggle.getAttribute("aria-checked")).toBe(String(enabled))
    expect(toggle.disabled).toBe(false)
  })

  it.each(["builtin.mail-internal-received", "builtin.mail-received"])("prevents context-free manual runs of %s in the list and card", async (type) => {
    const item = createItem({ trigger: { type, config: {} } })
    mocks.useAutomationItems.mockReturnValue({ items: [item], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<AutomationModule />) })
    const run = document.querySelector<HTMLButtonElement>('button[aria-label="需要信件上下文，无法手动运行"]')
    expect(run?.disabled).toBe(true)
    expect(run?.parentElement?.tabIndex).toBe(0)
    await act(async () => { run?.parentElement?.focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("需要信件上下文")
    await act(async () => { run?.click() })
    expect(mocks.runAutomation).not.toHaveBeenCalled()

    const onRun = vi.fn()
    await act(async () => { root.render(<TooltipProvider><AutomationCard item={item} projects={[]} pending={false} running={false}
      onRun={onRun} onStop={vi.fn()} onToggleEnabled={vi.fn()} onEdit={vi.fn()} onHistory={vi.fn()} onDelete={vi.fn()} /></TooltipProvider>) })
    const cardRun = document.querySelector<HTMLButtonElement>('button[aria-label="需要信件上下文，无法手动运行"]')
    expect(cardRun?.disabled).toBe(true)
    expect(cardRun?.parentElement?.tabIndex).toBe(0)
    await act(async () => { cardRun?.click() })
    expect(onRun).not.toHaveBeenCalled()
  })

  it("keeps legacy automations disabled and opens their stored configuration read-only", async () => {
    const legacy = createItem({
      schemaVersion: 1,
      name: "旧版日报",
      enabled: false,
      trigger: {
        type: "builtin.cron",
        config: { expr: "0 9 * * *", activeDays: [1, 2, 3, 4, 5], timeRange: { start: "08:00", end: "17:00" } },
      },
      executor: {
        type: "builtin.agent",
        config: { prompt: "旧版提示词", projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "default", mode: "default", sessionPolicy: "fresh" },
      },
    })
    mocks.useAutomationItems.mockReturnValue({ items: [legacy], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })

    expect(document.body.textContent).toContain("旧版已停用")
    expect(document.querySelector<HTMLButtonElement>('[aria-label="旧版自动化 旧版日报 已停用"]')?.disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[aria-label="编辑自动化 旧版日报"]')?.disabled).toBe(true)

    await act(async () => { document.querySelector<HTMLElement>('tbody tr')!.click() })
    const detail = document.querySelector('[data-layout="automation-detail"]')!
    expect(detail.textContent).toContain("旧版自动化已停用，请新建后重新配置。")
    expect(detail.textContent).toContain("旧版提示词")
    expect(Array.from(detail.querySelectorAll("button")).some(button => button.textContent === "编辑")).toBe(false)
    expect(Array.from(detail.querySelectorAll("button")).some(button => button.textContent === "启用")).toBe(false)
  })

  it("shows v2 conditions in a separate detail section", async () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({
        conditions: {
          operator: "or",
          items: [
            { type: "weekdays", days: [1, 3, 5] },
            { type: "daily-time-range", start: "08:00", end: "17:00" },
          ],
        },
      })],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })
    await act(async () => { document.querySelector<HTMLElement>('tbody tr')!.click() })

    const conditions = document.querySelector('[aria-label="附加条件"]')
    expect(conditions?.textContent).toContain("周一、周三、周五 或者 08:00–17:00")
  })

  it("opens the saved automation's read-only details after creating it", async () => {
    vi.spyOn(rendererActionRegistry, "getDefaultConfig").mockReturnValue(createItem().executor.config)
    mocks.useAutomationItems.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() })
    mocks.itemCreate.mockResolvedValue(createItem({ name: "已保存的自动化", enabled: false }))
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })
    await act(async () => { document.querySelector<HTMLButtonElement>('[data-system-app-top-bar] button:last-child')!.click() })
    await goToNamingStep()
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Agent")!.click() })
    await act(async () => {
      const input = document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "echo ok")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "仅保存")!.click() })
    expect(document.querySelector('[data-layout="automation-detail"] h1')?.textContent).toBe("已保存的自动化")
    expect(document.querySelector('input[aria-label="自动化名称"]')).toBeNull()
    expect(mocks.itemCreate.mock.calls[0][0].enabled).toBe(false)
  })
  it("keeps URL credentials out of both the detail summary and configuration fields", async () => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ executor: { type: "builtin.http-request", config: { method: "GET", url: "https://user:private-password@example.com/api?token=private-token" } } })], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })
    await act(async () => { document.querySelector<HTMLElement>('tbody tr')!.click() })
    const text = document.querySelector('[data-layout="automation-detail"]')!.textContent
    expect(text).toContain("example.com")
    expect(text).not.toContain("private-token")
    expect(text).not.toContain("private-password")
  })
  it("updates open details from item changes and prevents actions after deletion", async () => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem()], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<AutomationModule />) })
    await act(async () => { document.querySelector<HTMLElement>('tbody tr')!.click() })
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ name: "更新后的配置", enabled: false })], loading: false, error: null, refresh: vi.fn() })
    await act(async () => { root.render(<AutomationModule />) })
    expect(document.querySelector('[data-layout="automation-detail"] h1')!.textContent).toBe("更新后的配置")
    mocks.useAutomationItems.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() })
    await act(async () => { root.render(<AutomationModule />) })
    expect(document.querySelector('[role="alert"]')!.textContent).toBe("自动化不存在")
    expect(Array.from(document.querySelectorAll('button')).some(button => button.textContent === "编辑")).toBe(false)
  })
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

  it("shows that a configured daily range has no matching next run", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ nextRunAt: undefined, trigger: {
        type: "builtin.cron", config: { expr: "0 2 * * *" },
      }, conditions: { operator: "and", items: [
        { type: "weekdays", days: [1] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ] } })], loading: false, error: null, refresh: vi.fn(),
    })
    expect(renderToStaticMarkup(<AutomationModule />)).toContain("无匹配时间")
  })

  it("shows no matching time for an enabled interval beyond the date range", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ nextRunAt: undefined, trigger: {
        type: "builtin.interval", config: { everyMinutes: Number.MAX_SAFE_INTEGER, anchor: "created_at" },
      } })], loading: false, error: null, refresh: vi.fn(),
    })
    expect(renderToStaticMarkup(<AutomationModule />)).toContain("无匹配时间")
  })

  it("still renders an unavailable trigger with no next run", () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem({ nextRunAt: undefined, trigger: {
        type: "unavailable.trigger", config: { timeRange: { start: "08:00", end: "17:00" } },
      } })], loading: false, error: null, refresh: vi.fn(),
    })
    expect(renderToStaticMarkup(<AutomationModule />)).toContain("unavailable.trigger")
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
    expect(html).toContain("每 10 分钟")
    expect(html).toContain("Agent")
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
        <AutomationRunsPanel
          busy={false}
          item={createItem()}
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

  it("keeps a Claude Code terminal entry after the automation changes to Agent", async () => {
    mocks.listAutomationRuns.mockResolvedValueOnce([{
      id: "r1", schemaVersion: 1, automationId: "automation-1", status: "success", triggeredBy: "trigger",
      startedAt: "2026-11-05T00:00:00Z", triggerType: "builtin.cron", executorType: "builtin.claude-code",
      result: { status: "success", metrics: { durationMs: 1355 }, outputs: { projectId: "p1", sessionId: "s1" } },
    }])
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => root.render(<AutomationRunsPanel item={createItem()} busy={false} onStopRun={vi.fn()} />))
    await flushPromises()
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "查看结果")?.click() })
    expect(document.body.textContent).toContain("打开终端")
    expect(document.body.textContent).toContain("1.4s")
    expect(document.body.textContent).not.toContain("1355 ms")
  })

  it("returns from inline run history to the automation list", async () => {
    mocks.useAutomationItems.mockReturnValue({
      items: [createItem()],
      loading: false,
      error: null,
      refresh: vi.fn(),
    })
    mocks.listAutomationRuns.mockResolvedValue([])
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationModule />)
    })
    const historyButton = document.querySelector<HTMLButtonElement>('[aria-label="查看运行历史"]')
    await act(async () => {
      historyButton?.click()
    })
    await flushPromises()
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.getAttribute("aria-label") === "返回自动化列表")?.click()
    })

    expect(document.querySelector('[aria-label="查看运行历史"]')).not.toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("opens the create editor in the current page from the header action", async () => {
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

    expect(document.querySelector('input[aria-label="自动化名称"]')).not.toBeNull()
    expect(document.querySelector('[data-layout="automation-editor-trigger-panel"]')).not.toBeNull()
    expect(mocks.openCreateEditorWindow).not.toHaveBeenCalled()
  })

  it.each(["window", "dock", "launcher"] as const)("replaces and restores the automation header for create and edit in the %s host", async (host) => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ name: "已有任务" })], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    const app = <AutomationModule />
    await act(async () => { createRoot(container).render(host === "window" ? app : <EmbeddedSystemAppShell appName="自动化" mode={host} onBack={vi.fn()} onOpenWindow={vi.fn()}>{app}</EmbeddedSystemAppShell>) })
    const header = () => document.querySelector("[data-system-app-window-toolbar], [data-embedded-system-app-header]")!
    const checkEditor = () => {
      expect(document.querySelectorAll("[data-system-app-top-bar]")).toHaveLength(1)
      expect(header().querySelectorAll("button")).toHaveLength(1)
      expect(header().querySelector('[aria-label="返回自动化列表"]')).not.toBeNull()
      expect(header().textContent).toBe("")
      expect(document.querySelector('[data-layout="automation-editor-trigger-panel"]')).not.toBeNull()
    }
    const checkList = () => {
      expect(header().textContent).toContain("新建")
      expect(header().querySelector('[aria-label="刷新"]')).not.toBeNull()
      expect(Boolean(header().querySelector('[aria-label="新窗口打开"]'))).toBe(host === "launcher")
    }
    checkList()
    await act(async () => { Array.from(header().querySelectorAll("button")).find(button => button.textContent === "新建")!.click() })
    checkEditor()
    await act(async () => { (header().querySelector('[aria-label="返回自动化列表"]') as HTMLButtonElement).click() })
    checkList()
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "已有任务")!.click() })
    expect(document.querySelector('input[aria-label="自动化名称"]')).toBeNull()
    expect(document.body.textContent).toContain("概览")
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "编辑")!.click() })
    checkEditor()
    await act(async () => { (header().querySelector('[aria-label="返回自动化列表"]') as HTMLButtonElement).click() })
    expect(document.body.textContent).toContain("概览")
    await act(async () => { (header().querySelector('[aria-label="返回自动化列表"]') as HTMLButtonElement).click() })
    checkList()
  })

  it("discards an unsaved automation without leaving a resumable draft", async () => {
    mocks.useAutomationItems.mockReturnValue({ items: [createItem({ name: "已有任务" })], loading: false, error: null, refresh: vi.fn() })
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })
    const click = (text: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === text)!.click()
    await act(async () => { click("新建") })
    await goToNamingStep()
    await act(async () => {
      const name = document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "未保存内容")
      name.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="返回自动化列表"]')!.click() })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => { click("放弃") })
    expect(document.body.textContent).not.toContain("未保存内容")
    expect(document.body.textContent).not.toContain("草稿")
    await act(async () => { click("新建") })
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')!.value).not.toBe("未保存内容")
    expect(document.querySelector('#automation-trigger-cron-expr')).toBeNull()
  })

  it("saves from the leave dialog and returns to the list instead of opening details", async () => {
    vi.spyOn(rendererActionRegistry, "getDefaultConfig").mockReturnValue(createItem().executor.config)
    mocks.useAutomationItems.mockReturnValue({ items: [], loading: false, error: null, refresh: vi.fn() })
    mocks.itemCreate.mockResolvedValue(createItem({ enabled: false }))
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationModule />) })
    const click = (text: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === text)!.click()
    await act(async () => { click("新建") })
    await goToNamingStep()
    await act(async () => { click("Agent") })
    await act(async () => {
      const prompt = document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(prompt, "echo ok")
      prompt.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="返回自动化列表"]')!.click() })
    await act(async () => { click("保存") })
    expect(mocks.itemCreate).toHaveBeenCalledOnce()
    expect(document.querySelector('[data-layout="automation-detail"]')).toBeNull()
    expect(document.querySelector('input[aria-label="自动化名称"]')).toBeNull()
    expect(document.querySelector('input[aria-label="搜索自动化"]')).not.toBeNull()
    const navigate = vi.fn()
    await act(async () => { await runAppNavigation(navigate) })
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("does not let a late history retry replace newer history results", async () => {
    let finishRetry!: (runs: unknown[]) => void
    mocks.listAutomationRuns.mockRejectedValueOnce(new Error("first load failed"))
      .mockReturnValueOnce(new Promise(resolve => { finishRetry = resolve }))
      .mockResolvedValueOnce([])
    const container = document.createElement("div"); document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => { root.render(<AutomationRunsPanel busy={false} item={createItem()} onStopRun={vi.fn()} />) })
    await act(async () => { Array.from(document.querySelectorAll("button")).find(b => b.textContent === "重试")!.click() })
    await act(async () => { root.render(<AutomationRunsPanel busy={false} item={createItem({ name: "新快照" })} onStopRun={vi.fn()} />) })
    await act(async () => { finishRetry([{ id: "old-run", schemaVersion: 1, automationId: "automation:1", status: "failed", error: "过期运行结果", startedAt: "2026-11-05T00:00:00Z", triggeredBy: "manual", triggerType: "builtin.cron", executorType: "builtin.command" }]) })
    expect(document.body.textContent).toContain("暂无运行记录")
    expect(document.body.textContent).not.toContain("过期运行结果")
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

  it("opens read-only details from a list row and enters a separate edit form explicitly", async () => {
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

    expect(document.querySelector('input[aria-label="自动化名称"]')).toBeNull()
    expect(document.querySelector('[role="tablist"]')?.textContent).toContain("概览")
    expect(document.body.textContent).toContain("echo ok")
    await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "编辑")!.click() })
    expect(document.body.textContent).toContain("编辑自动化")
    expect(document.querySelector('#automation-trigger-interval-minutes')).not.toBeNull()
    expect(mocks.openEditorWindow).not.toHaveBeenCalled()
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

    expect(mocks.openEditorWindow).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("编辑自动化")
    expect(document.querySelector('#automation-trigger-interval-minutes')).not.toBeNull()
    expect(mocks.openEditorWindow).not.toHaveBeenCalled()
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

    expect(document.activeElement).toBe(deleteButton())

    await act(async () => {
      deleteButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, altKey: true }))
    })
    await flushPromises()

    expect(mocks.deleteAutomation).toHaveBeenCalledWith("automation:1")
    expect(refresh).toHaveBeenCalled()
  })

  it("focuses new after confirming deletion", async () => {
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
    await act(async () => {
      document.querySelector<HTMLButtonElement>('button[aria-label="删除自动化"]')?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll("button"))
        .find((button) => button.textContent === "删除")?.click()
    })
    await flushPromises()
    await act(async () => {
      await new Promise((resolve) => window.setTimeout(resolve))
    })

    expect(document.activeElement).toBe(
      Array.from(document.querySelectorAll("button")).find((button) => button.textContent === "新建"),
    )
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
    schemaVersion: 2,
    name: "Daily report",
    description: "Daily summary",
    enabled: true,
    scope: { type: "global" },
    trigger: {
      type: "builtin.interval",
      config: { everyMinutes: 10, anchor: "created_at" },
    },
    executor: {
      type: "builtin.agent",
      config: { projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "default", mode: "default", prompt: "echo ok", sessionPolicy: "fresh", timeoutMins: 30 },
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

async function goToNamingStep() {
  await act(async () => { Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Cron")!.click() })
}
