// @vitest-environment jsdom

import { act, useMemo } from "react"
import { createRoot as createReactRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
import { AutomationEditorForm } from "../editor-form"
import type { AutomationEditorMode } from "../../types"
import type { AutomationItem } from "@/types/automation"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

const roots = new Set<Root>()
function createRoot(container: Element) { const root = createReactRoot(container); roots.add(root); return root }
function AutomationEditorApp() {
  const mode = useMemo<AutomationEditorMode>(() => {
    const params = new URLSearchParams(window.location.search)
    return params.get("mode") === "edit" ? { mode: "edit", automationId: params.get("automationId")! } : { mode: "create" }
  }, [])
  return <AutomationEditorForm mode={mode} onBack={() => undefined} />
}

const createItem = vi.fn()
const updateItem = vi.fn()
const getItem = vi.fn()
const listItems = vi.fn()
const listProviders = vi.fn()

vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({
    item: {
      get: getItem,
      list: listItems,
      create: createItem,
      update: updateItem,
    },
  }),
  requireSynapseBridge: () => ({
    agent: {
      listProviders,
    },
  }),
}))

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

describe("AutomationEditorApp", () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
    listItems.mockResolvedValue([])
    listProviders.mockResolvedValue([
      {
        id: "provider-1",
        name: "Provider One",
        active: true,
        model: "model-default",
        sonnetModel: "model-sonnet",
      },
    ])
  })

  afterEach(async () => {
    await act(async () => { roots.forEach(root => root.unmount()) }); roots.clear()
    document.body.innerHTML = ""
    Reflect.deleteProperty(window, "synapse")
    vi.clearAllMocks()
    vi.restoreAllMocks()
    window.history.replaceState(null, "", "/")
  })

  it.each(["builtin.cron", "builtin.interval"])("edits and clears the daily range for %s", async (type) => {
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    const config = type === "builtin.cron"
      ? { expr: "* * * * *" }
      : { everyMinutes: 60, anchor: "created_at" }
    const item = buildAutomationItem({
      trigger: { type, config },
      conditions: { operator: "and", items: [{ type: "daily-time-range", start: "08:00", end: "17:00" }] },
    })
    getItem.mockResolvedValue(item)
    updateItem.mockResolvedValue(item)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<AutomationEditorApp />) })
      const rangeTrigger = document.querySelector<HTMLButtonElement>('button[id$="-time-range"]')
      expect(rangeTrigger?.textContent).toContain("08:00")
      await act(async () => { rangeTrigger?.click() })
      await selectTimePart("结束小时", "24")
      await act(async () => { findButtonContaining("确定")?.click() })
        await act(async () => { saveButton()?.click() })
      expect(updateItem).toHaveBeenLastCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          trigger: { type, config },
          conditions: { operator: "and", items: [{ type: "daily-time-range", start: "08:00", end: "24:00" }] },
        }),
      }))
      // Reopen the returned config, then remove the condition.
      updateItem.mockClear()
      getItem.mockResolvedValue(buildAutomationItem({
        trigger: { type, config },
        conditions: { operator: "and", items: [{ type: "daily-time-range", start: "08:00", end: "24:00" }] },
      }))
      await act(async () => { window.dispatchEvent(new Event("focus")) })
      const reloadedRangeTrigger = document.querySelector<HTMLButtonElement>('button[id$="-time-range"]')
      expect(reloadedRangeTrigger?.textContent).toContain("08:00")
      expect(reloadedRangeTrigger?.textContent).toContain("24:00")
      await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="删除每天的时间段条件"]')?.click() })
        await act(async () => { saveButton()?.click() })
      expect(updateItem).toHaveBeenLastCalledWith(expect.objectContaining({
        patch: expect.objectContaining({ trigger: { type, config }, conditions: null }),
      }))
    } finally { await act(async () => { root.unmount() }) }
  })

  it("keeps an invalid picker draft out of the saved automation config", async () => {
    const item = buildAutomationItem({
      conditions: { operator: "and", items: [{ type: "daily-time-range", start: "08:00", end: "17:00" }] },
    })
    getItem.mockResolvedValue(item)
    updateItem.mockResolvedValue(item)
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(<AutomationEditorApp />) })
      await act(async () => { document.querySelector<HTMLButtonElement>('button[id$="-time-range"]')?.click() })
      await selectTimePart("开始小时", "18")
      expect(findButtonContaining("确定")?.disabled).toBe(true)
      expect(document.body.textContent).toContain("结束时间必须晚于开始时间")
      expect(updateItem).not.toHaveBeenCalled()
      await act(async () => {
        document.querySelector('[role="combobox"][aria-label="开始小时"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      })
        await act(async () => { saveButton()?.click() })
      expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
        patch: expect.objectContaining({
          trigger: item.trigger,
          conditions: item.conditions,
        }),
      }))
    } finally { await act(async () => { root.unmount() }) }
  })

  it("blocks saving when a weekday condition has no selected day", async () => {
    const item = buildAutomationItem({
      conditions: { operator: "and", items: [{ type: "weekdays", days: [1] }] },
    })
    getItem.mockResolvedValue(item)
    updateItem.mockResolvedValue(item)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<AutomationEditorApp />) })
    await act(async () => { document.querySelector<HTMLElement>('[role="checkbox"][aria-label="周一"]')?.click() })
    await act(async () => { saveButton()?.click() })

    expect(document.body.textContent).toContain("至少选择一个星期")
    expect(updateItem).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
  })

  it("shows trigger and executor lists in create mode", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("当以下情况发生时")
    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).toContain("固定间隔")
    expect(document.body.textContent).toContain("执行以下操作")
    await act(async () => { findButtonContaining("Cron")!.click() })
    expect(document.body.textContent).toContain("执行以下操作")
    expect(document.body.textContent).not.toContain("命令")
    expect(document.body.textContent).toContain("Agent")
    expect(document.body.textContent).not.toContain("工作流")
  })

  it("does not show default config summaries before trigger and executor are selected", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    expect(document.body.textContent).toContain("Cron")
    expect(document.body.textContent).not.toContain("HTTP 请求")
    expect(document.body.textContent).not.toContain("Cron · 0 9 * * *")
    expect(document.body.textContent).not.toContain("命令 · 未设置")
    expect(findButtonContaining("Agent")?.disabled).toBe(true)

    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })

    expect(document.querySelector('[aria-label="流程摘要"]')?.textContent).toContain("Cron")
    expect(document.querySelector('[data-layout="automation-editor-executor-summary"]')?.textContent)
      .toContain("Agent")
  })

  it("opens trigger variables in a dialog and copies a static template", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="查看触发变量"]')?.click()
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain("来自「Cron」")
    expect(dialog?.textContent).toContain("触发信息")
    expect(dialog?.textContent).toContain("触发时间")
    expect(dialog?.textContent).toContain("{{trigger.triggeredAt}}")
    expect(dialog?.querySelector('[aria-label="复制 {{trigger.triggeredAt}}"')).not.toBeNull()
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()

    await act(async () => {
      findButtonContaining("{{trigger.triggeredAt}}")?.click()
    })

    expect(writeText).toHaveBeenCalledWith("{{trigger.triggeredAt}}")
    expect(document.body.textContent).toContain("已复制")
  })

  it("filters trigger variables by label and key", async () => {
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="查看触发变量"]')?.click()
    })

    await act(async () => { findButtonContaining("全部")?.click() })
    const searchInput = document.querySelector<HTMLInputElement>('input[aria-label="搜索变量"]')
    await act(async () => {
      if (!searchInput) return
      changeInput(searchInput, "timezone")
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain("{{trigger.timezone}}")
    expect(dialog?.textContent).toContain("时区")
    expect(dialog?.textContent).not.toContain("{{trigger.automationName}}")
  })

  it("shows webhook whole payload and dynamic variables", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Webhook")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="查看触发变量"]')?.click()
    })

    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain("来自「Webhook」")
    expect(dialog?.textContent).toContain("事件内容")
    expect(dialog?.textContent).toContain("完整 Webhook")
    expect(dialog?.textContent).toContain("{{trigger.payload}}")
    expect(dialog?.textContent).toContain("可指定路径")
    expect(dialog?.textContent).toContain("{{trigger.request.body}}")

    await act(async () => {
      findButtonContaining("{{trigger.payload}}")?.click()
    })

    expect(writeText).toHaveBeenCalledWith("{{trigger.payload}}")

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="设置 请求 Body"]')?.click()
    })
    const bodyPathInput = document.querySelector<HTMLInputElement>('input[aria-label="请求 Body 字段路径"]')
    expect(bodyPathInput).not.toBeNull()
    await act(async () => {
      if (!bodyPathInput) return
      changeInput(bodyPathInput, "repository.full_name")
    })

    expect(dialog?.textContent).toContain("{{trigger.request.body.repository.full_name}}")
  })

  it("shows copy failure feedback in the variable panel", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"))
    Object.assign(navigator, { clipboard: { writeText } })
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="查看触发变量"]')?.click()
    })
    await act(async () => {
      findButtonContaining("{{trigger.triggeredAt}}")?.click()
    })

    expect(writeText).toHaveBeenCalledWith("{{trigger.triggeredAt}}")
    expect(document.body.textContent).toContain("复制失败")
  })

  it("shows a generated automation name in create mode instead of an empty title input", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    await openNamingStep()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')?.value).toBe("自动化 #0000")
    expect(document.querySelector('input[aria-label="自动化标题"]')).toBeNull()
  })

  it("blocks direct editing of a legacy automation", async () => {
    getItem.mockResolvedValue(buildAutomationItem({
      schemaVersion: 1,
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", activeDays: [1] } },
    }))
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => { root.render(<AutomationEditorApp />) })

    expect(document.body.textContent).toContain("旧版自动化不可编辑")
    expect(document.querySelector("#automation-trigger-cron-expr")).toBeNull()
    expect(updateItem).not.toHaveBeenCalled()
    await act(async () => { root.unmount() })
  })

  it("reloads edit data when the page is focused again", async () => {
    getItem.mockReset()
    getItem
      .mockResolvedValueOnce(buildAutomationItem({ name: "旧配置" }))
      .mockResolvedValueOnce(buildAutomationItem({ name: "新配置" }))
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await openNamingStep()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')?.value).toBe("旧配置")

    await act(async () => {
      window.dispatchEvent(new Event("focus"))
    })

    expect(getItem).toHaveBeenCalledTimes(2)
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')?.value).toBe("新配置")
    expect(document.body.textContent).not.toContain("旧配置")
  })

  it("does not send cached enabled state when saving edit changes without enabling", async () => {
    getItem.mockResolvedValue(buildAutomationItem({ enabled: true, name: "旧名称" }))
    updateItem.mockResolvedValue(buildAutomationItem({ enabled: false, name: "新名称" }))
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) =>
        button.textContent?.includes("旧名称"))?.click()
    })
    const nameInput = document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')
    await act(async () => {
      if (!nameInput) return
      changeInput(nameInput, "新名称")
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "确认")?.click()
    })
    await act(async () => {
      saveButton()?.click()
      await Promise.resolve()
    })

    expect(updateItem).toHaveBeenCalledWith({
      id: "automation:1",
      patch: expect.not.objectContaining({ enabled: expect.any(Boolean) }),
    })
  })

  it("generates a different create-mode name when the first random suffix already exists", async () => {
    listItems.mockResolvedValue([{ name: "自动化 #0000" }])
    vi.spyOn(Math, "random")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
      .mockReturnValueOnce(1 / 36)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })

    await openNamingStep()
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')?.value).toBe("自动化 #1111")
    expect(document.body.textContent).not.toContain("自动化 #0000")
  })

  it("edits the automation name inline without a dialog", async () => {
    window.history.replaceState(null, "", "/?mode=create")
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    await openNamingStep()
    const name = document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')!
    await act(async () => { changeInput(name, "每日总结") })
    expect(name.value).toBe("每日总结")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it("keeps the current trigger until a replacement is confirmed", async () => {
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    await act(async () => { findButtonContaining("Cron")!.click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    await act(async () => { findButtonContaining("固定间隔")!.click() })
    expect(document.querySelector('[role="alertdialog"]')).not.toBeNull()
    await act(async () => { Array.from(document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')).find(button => button.textContent === "取消")!.click() })
    expect(findButtonContaining("取消更换")).toBeUndefined()
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
  })

  it("offers manual trigger in its own group without a trigger config form", async () => {
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    await act(async () => { findButtonContaining("Cron")!.click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    expect(document.body.textContent).toContain("按手动")
    expect(document.body.textContent).toContain("手动触发")
    await act(async () => { findButtonContaining("手动触发")!.click() })
    await act(async () => { findButtonContaining("确认更换")!.click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).toBeNull()
    expect(document.querySelector('[aria-label="查看触发变量"]')).not.toBeNull()
  })

  it("does not describe manual trigger conditions as an execution gate", async () => {
    const item = buildAutomationItem({
      trigger: { type: "builtin.manual", config: {} },
      conditions: { operator: "and", items: [{ type: "weekdays", days: [1, 2, 3, 4, 5] }] },
    })
    getItem.mockResolvedValue(item)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    expect(document.querySelector('[aria-label="流程摘要"]')?.textContent).not.toContain("符合条件")
  })

  it("preserves automation conditions when the trigger type changes", async () => {
    const conditions = { operator: "and" as const, items: [{ type: "weekdays" as const, days: [1, 3, 5] }] }
    const item = buildAutomationItem({
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      conditions,
    })
    getItem.mockResolvedValue(item)
    updateItem.mockResolvedValue({ ...item, trigger: { type: "builtin.interval", config: { everyMinutes: 10, anchor: "created_at" } } })
    window.history.replaceState(null, "", "/?window=automation-editor&mode=edit&automationId=automation:1")
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    await act(async () => { findButtonContaining("固定间隔")!.click() })
    await act(async () => { findButtonContaining("确认更换")!.click() })
    await act(async () => { saveButton()?.click() })

    expect(updateItem).toHaveBeenCalledWith(expect.objectContaining({
      patch: expect.objectContaining({
        trigger: { type: "builtin.interval", config: { everyMinutes: 60, anchor: "created_at" } },
        conditions,
      }),
    }))
  })

  it("shows both nodes without a connecting arrow and keeps actions inside the scrolling content", async () => {
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    expect(document.querySelector('[data-layout="automation-editor-executor-panel"]')).not.toBeNull()
    expect(saveButton()?.closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
    expect(document.querySelector('[data-layout="automation-editor-divider"]')).toBeNull()
  })

  it("opens trigger configuration alongside the executor choices", async () => {
    const container = document.createElement("div"); document.body.appendChild(container)
    await act(async () => { createRoot(container).render(<AutomationEditorApp />) })
    await act(async () => { findButtonContaining("Cron")!.click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
    expect(document.querySelector('[data-layout="automation-editor-executor-panel"]')).not.toBeNull()
    expect(findButtonContaining("Agent")?.disabled).toBe(false)
  })

  it("constrains long executor content inside the editor viewport", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })

    const body = document.querySelector('[data-layout="automation-editor-body"]')
    const executorPanel = document.querySelector('[data-layout="automation-editor-executor-panel"]')
    const executorConfig = document.querySelector('[data-layout="automation-editor-executor-config"]')

    expect(body?.closest('[data-slot="scroll-area"]')).not.toBeNull()
    expect(executorPanel?.className).toContain("min-w-0")
    expect(executorConfig?.className).toContain("min-w-0")
  })

  it("separates selected summaries from configuration panels", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })

    const executorSummary = document.querySelector('[data-layout="automation-editor-executor-summary"]')
    const executorConfig = document.querySelector('[data-layout="automation-editor-executor-config"]')

    expect(executorSummary?.textContent).toContain("Agent")
    expect(executorSummary?.textContent).not.toContain("Shell")
    expect(document.body.textContent).not.toContain("触发器")
    expect(document.body.textContent).not.toContain("执行器")
    expect(Array.from(document.querySelectorAll('[data-slot="badge"]')).map((badge) => badge.textContent))
      .not.toContain("配置")
    expect(document.querySelector('[data-layout="automation-editor-trigger-config-separator"]')).toBeNull()
    expect(document.querySelector('[data-layout="automation-editor-executor-config-separator"]')).toBeNull()
    expect(executorSummary?.compareDocumentPosition(executorConfig as Node) ?? 0)
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it.each([undefined, { start: "08:00", end: "17:00" }])("saves Agent automation on Windows with the selected daily range %j", async (timeRange) => {
    vi.spyOn(rendererActionRegistry, "getDefaultConfig").mockReturnValue(buildAutomationItem().executor.config)
    window.synapse = { platform: "win32", settings: { repository: {} } } as typeof window.synapse
    createItem.mockResolvedValue(buildAutomationItem())
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    if (timeRange) {
      await act(async () => { clickMenuTrigger(findButtonContaining("添加条件")) })
      await act(async () => { findButtonContaining("每天的时间段")?.click() })
      await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
      await act(async () => { document.querySelector<HTMLButtonElement>('button[id$="-time-range"]')?.click() })
      await act(async () => { findButtonContaining("确定")?.click() })
    }

    await act(async () => {
      findButtonContaining("Agent")?.click()
    })


    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")
    await act(async () => {
      if (!prompt) return
      changeTextarea(prompt, "echo ok")
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "保存并启用")?.click()
    })

    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      trigger: { type: "builtin.cron", config: {
        expr: "0 9 * * *",
      } },
      ...(timeRange ? {
        conditions: {
          operator: "and",
          items: [{ type: "daily-time-range", ...timeRange }],
        },
      } : {}),
      executor: {
        type: "builtin.agent",
        config: expect.objectContaining({
          prompt: "echo ok",
          timeoutMins: 30,
        }),
      },
    }))
  })

  it("shows a discard confirmation when closing with unsaved changes", async () => {
    const closeSpy = vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent?.includes("Cron"))?.click()
    })
    await act(async () => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }))
    })

    expect(document.body.textContent).toContain("更改尚未保存")

    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "放弃")?.click()
    })

    expect(closeSpy).toHaveBeenCalledTimes(1)
  })

  it("restores focus after Escape cancels closing with unsaved changes", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    const triggerButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]'))
      .find((button) => button.getAttribute("aria-label") === "更换触发条件")
    triggerButton?.focus()

    await act(async () => {
      window.dispatchEvent(new Event("beforeunload", { cancelable: true }))
    })
    await act(async () => {
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
    })

    // Radix restores focus on the next task after unmounting the dialog.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.activeElement).toBe(triggerButton)
  })

  it("keeps partial Agent executor config while editing", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })

    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")
    expect(prompt).not.toBeNull()

    await act(async () => {
      if (!prompt) return
      changeTextarea(prompt, "Reply exactly OK")
    })

    expect(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")?.value)
      .toBe("Reply exactly OK")
  })

  it("saves Agent executor config with project and provider model selection", async () => {
    createItem.mockResolvedValue({
      id: "automation:agent",
      schemaVersion: 2,
      name: "Agent automation",
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
      executor: {
        type: "builtin.agent",
        config: {
          projectId: "project-1",
          agentType: "claude-code",
          providerId: "provider-1",
          modelTier: "sonnet",
          mode: "bypassPermissions",
          prompt: "Reply exactly OK",
          sessionPolicy: "fresh",
          timeoutMins: 60,
        },
      },
      policy: { missedRunPolicy: "skip", overlapPolicy: "skip" },
      createdAt: "2026-06-03T00:00:00.000Z",
      updatedAt: "2026-06-03T00:00:00.000Z",
      runCount: 0,
      configVersion: 0,
    })
    vi.spyOn(window, "close").mockImplementation(() => undefined)
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })
    await act(async () => {
      document.querySelector<HTMLElement>("[data-testid='automation-agent-project-select']")?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLElement>("[role='option']"))
        .find((option) => option.textContent?.includes("Synapse"))?.click()
    })
    await act(async () => {
      document.querySelector<HTMLButtonElement>("#task-action-agent-provider")?.click()
      await Promise.resolve()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "确认")?.click()
    })
    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")
    await act(async () => {
      if (!prompt) return
      changeTextarea(prompt, "Reply exactly OK")
    })
    const timeout = document.querySelector<HTMLInputElement>("#task-action-agent-timeout")
    await act(async () => {
      if (!timeout) return
      changeInput(timeout, "5")
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "保存并启用")?.click()
    })

    expect(createItem).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      scope: { type: "project", projectId: "project-1" },
      executor: {
        type: "builtin.agent",
        config: expect.objectContaining({
          projectId: "project-1",
          providerId: "provider-1",
          modelTier: "sonnet",
          prompt: "Reply exactly OK",
          timeoutMins: 5,
        }),
      },
    }))
  })

  it("shows readable Agent validation errors instead of raw Zod JSON", async () => {
    window.history.replaceState(null, "", "/?window=automation-editor&mode=create")
    const rootElement = document.createElement("div")
    document.body.appendChild(rootElement)
    const root = createRoot(rootElement)

    await act(async () => {
      root.render(<AutomationEditorApp />)
    })
    await act(async () => {
      findButtonContaining("Cron")?.click()
    })
    await act(async () => {
      findButtonContaining("Agent")?.click()
    })
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find((button) => button.textContent === "保存并启用")?.click()
    })

    expect(document.body.textContent).toContain("请选择项目")
    expect(document.body.textContent).toContain("请选择供应商和模型")
    expect(document.body.textContent).toContain("请填写提示词")
    expect(document.body.textContent).not.toContain("\"origin\"")
    expect(document.body.textContent).not.toContain("\"code\"")
  })
})

function changeInput(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  if (!setter) throw new Error("Input value setter not found")
  setter.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}

function changeTextarea(textarea: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  if (!setter) throw new Error("Textarea value setter not found")
  setter.call(textarea, value)
  textarea.dispatchEvent(new Event("input", { bubbles: true }))
}

function findButtonContaining(text: string): HTMLButtonElement | undefined {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitem"], [role="menuitemradio"]'))
    .find((button) => button.textContent?.includes(text))
}

function clickMenuTrigger(element: HTMLButtonElement | undefined): void {
  if (!element) return
  element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  element.click()
}

function buildAutomationItem(overrides: Partial<AutomationItem> = {}): AutomationItem {
  return {
    id: "automation:1",
    schemaVersion: 2,
    name: "自动化",
    description: "",
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

async function selectTimePart(label: string, value: string): Promise<void> {
  const trigger = document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)
  expect(trigger).not.toBeNull()
  await act(async () => { trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find((element) => element.textContent === value)
  expect(option).toBeDefined()
  await act(async () => { option!.click() })
}

async function openNamingStep() {
  if (!document.querySelector('[data-layout="automation-editor-trigger-config"]')) {
    await act(async () => { findButtonContaining("Cron")!.click() })
  }
}

function saveButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find(button => button.textContent === "仅保存" || button.textContent === "保存更改")
}
