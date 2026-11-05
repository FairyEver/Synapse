// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { runAppNavigation } from "@/app-shell/navigation-guard"
import { EmbeddedSystemAppShell } from "@/modules/apps/components/embedded-system-app-shell"
import { AutomationEditorForm } from "../editor-form"
import type { AutomationItem } from "@/types/automation"

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({ requireBridgeDomain: () => ({ item: api }) }))
vi.mock("@/app-shell/config", () => ({ useAppConfig: () => ({ config: { global: { projects: [] } } }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver
let root: Root
function item(): AutomationItem {
  return { schemaVersion: 1, runCount: 0, configVersion: 1, id: "automation:1", name: "每日构建", enabled: false, scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *", activeDays: [0, 1, 2, 3, 4, 5, 6] } },
    executor: { type: "builtin.command", config: { command: "echo ok", shell: "cmd", timeoutMins: 30 } },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" }, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }
}
const button = (text: string) => Array.from(document.querySelectorAll("button")).find(b => b.textContent === text)!
function change(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
async function renderEditor(props: Record<string, unknown> = {}) {
  await act(async () => { root.render(<AutomationEditorForm {...{ mode: { mode: "create" as const }, onBack: vi.fn(), ...props }} />) })
}
async function configure() {
  await act(async () => { button("Cron").click() })
  await act(async () => { button("下一步").click() })
  await act(async () => { button("命令").click() })
  await act(async () => { change(document.querySelector<HTMLInputElement>("#task-action-command-content")!, "echo ok") })
}
beforeEach(() => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  api.list.mockResolvedValue([]); api.get.mockResolvedValue(item()); api.create.mockResolvedValue(item()); api.update.mockResolvedValue(item())
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(window, "close").mockImplementation(() => undefined)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); vi.restoreAllMocks() })
describe("inline automation editing", () => {
  it("configures the trigger before the executor and keeps navigation below the scrolling form", async () => {
    await renderEditor()
    expect(document.body.textContent).toContain("何时触发")
    expect(document.querySelector('#task-action-command-content')).toBeNull()
    expect(button("下一步").disabled).toBe(true)
    await act(async () => { button("Cron").click() })
    const next = button("下一步")
    expect(next.closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
    await act(async () => { next.click() })
    expect(document.body.textContent).toContain("执行什么操作")
    expect(document.querySelector('#automation-trigger-cron-expr')).toBeNull()
    await act(async () => { button("命令").click() })
    await act(async () => { change(document.querySelector<HTMLInputElement>('#task-action-command-content')!, "echo retained") })
    await act(async () => { button("上一步").click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
    await act(async () => { button("下一步").click() })
    expect(document.querySelector<HTMLInputElement>('#task-action-command-content')!.value).toBe("echo retained")
    expect(button("仅保存").closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
    expect(document.querySelector('footer')).toBeNull()
  })
  it("blocks an invalid trigger before entering executor configuration", async () => {
    await renderEditor()
    await act(async () => { button("固定间隔").click() })
    await act(async () => { change(document.querySelector<HTMLInputElement>('#automation-trigger-interval-minutes')!, "0") })
    await act(async () => { button("下一步").click() })
    expect(document.querySelector('#automation-trigger-interval-minutes')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })
  it("checks Cron syntax before advancing", async () => {
    await renderEditor()
    await act(async () => { button("Cron").click() })
    await act(async () => { change(document.querySelector<HTMLInputElement>('#automation-trigger-cron-expr')!, "70 9 * * *") })
    await act(async () => { button("下一步").click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy()
  })
  it("waits for type replacement or cancellation before advancing or saving", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.click() })
    expect(button("下一步").disabled).toBe(true)
    await act(async () => { button("取消更换").click() })
    await act(async () => { button("下一步").click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换执行操作"]')!.click() })
    expect(button("仅保存").disabled).toBe(true)
    await act(async () => { button("取消更换").click() })
    expect(button("仅保存").disabled).toBe(false)
  })
  it("requires replacing variables that belong to the previous trigger", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("下一步").click() })
    await act(async () => { change(document.querySelector<HTMLInputElement>('#task-action-command-content')!, "echo {{trigger.cron}}") })
    await act(async () => { button("上一步").click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.click() })
    await act(async () => { button("固定间隔").click() })
    await act(async () => { button("确认更换").click() })
    await act(async () => { button("下一步").click() })
    expect(document.querySelector<HTMLInputElement>('#task-action-command-content')!.value).toBe("echo {{trigger.cron}}")
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("trigger.cron")
    expect(api.update).not.toHaveBeenCalled()
  })
  it("preserves existing runtime variables that are not listed in the trigger picker", async () => {
    const value = item()
    value.trigger = { type: "builtin.webhook", config: { webhookPublicId: "hook-1" } }
    value.executor.config.command = "echo {{trigger.request.remoteAddress}}"
    api.get.mockResolvedValueOnce(value)
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("下一步").click() })
    await act(async () => { button("仅保存").click() })
    expect(api.update).toHaveBeenCalledOnce()
  })
  it("checks a user parameter named source when its trigger was replaced", async () => {
    const value = item()
    value.trigger = { type: "builtin.webhook", config: { webhookPublicId: "hook-1" } }
    value.executor = { type: "builtin.http-request", config: { method: "GET", url: "https://example.com", query: { source: "{{trigger.request.body.id}}" } } }
    api.get.mockResolvedValueOnce(value)
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.click() })
    await act(async () => { button("Cron").click() })
    await act(async () => { button("确认更换").click() })
    await act(async () => { button("下一步").click() })
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("trigger.request.body.id")
    expect(api.update).not.toHaveBeenCalled()
  })
  it.each(["window", "dock", "launcher"] as const)("uses one shared header in the %s host", async (host) => {
    const onBack = vi.fn()
    const form = <AutomationEditorForm mode={{ mode: "create" }} onBack={onBack} />
    await act(async () => { root.render(host === "window" ? form : <EmbeddedSystemAppShell appName="自动化" mode={host} onOpenWindow={vi.fn()}>{form}</EmbeddedSystemAppShell>) })
    const headers = document.querySelectorAll("[data-system-app-window-toolbar], [data-embedded-system-app-header]")
    expect(headers).toHaveLength(1)
    expect(headers[0].querySelector('[aria-label="返回自动化列表"]')).not.toBeNull()
    expect(headers[0].querySelectorAll("button")).toHaveLength(1)
    expect(headers[0].textContent).toBe("")
    expect(headers[0].querySelector('[role="status"]')).toBeNull()
    await act(async () => { (headers[0].querySelector('button[aria-label="返回自动化列表"]') as HTMLButtonElement).click() })
    expect(onBack).toHaveBeenCalledOnce()
  })
  it("saves a new automation once and updates that same item on the next save without closing", async () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => undefined)
    await renderEditor(); await configure()
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('input[aria-label="自动化名称"]')).not.toBeNull()
    expect(close).not.toHaveBeenCalled()
    await act(async () => { button("仅保存").click() })
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.create.mock.calls[0][0].enabled).toBe(false)
    expect(api.update).toHaveBeenCalledWith({ id: "automation:1", patch: expect.not.objectContaining({ enabled: expect.anything() }) })
  })
  it("renames directly and keeps an existing item's enabled state out of a save-only patch", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("下一步").click() })
    const name = document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')
    expect(name).not.toBeNull()
    await act(async () => { change(name!, "新的名称") })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { button("仅保存").click() })
    expect(api.update.mock.calls[0][0].patch.name).toBe("新的名称")
    expect(api.update.mock.calls[0][0].patch).not.toHaveProperty("enabled")
  })
  it("keeps an unsaved editor on the page and returns its draft only after explicitly stashing", async () => {
    const onBack = vi.fn()
    await renderEditor({ onBack }); await configure()
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="返回自动化列表"]')!.click() })
    expect(onBack).not.toHaveBeenCalled()
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(document.body.textContent).toContain("更改尚未保存")
    await act(async () => { button("暂存草稿并返回").click() })
    expect(onBack).toHaveBeenCalledWith(expect.objectContaining({ draft: expect.objectContaining({ executorType: "builtin.command" }) }))
  })
  it("blocks app navigation until the user explicitly discards changes", async () => {
    await renderEditor(); await configure()
    const navigate = vi.fn()
    let pending!: Promise<boolean>
    await act(async () => { pending = runAppNavigation(navigate) })
    expect(navigate).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("更改尚未保存")
    await act(async () => { button("放弃修改").click(); await pending })
    expect(navigate).toHaveBeenCalledOnce()
  })
  it("keeps a failed save editable and allows retry without creating a second saved item", async () => {
    api.create.mockRejectedValueOnce(new Error("save unavailable"))
    await renderEditor(); await configure()
    await act(async () => { button("仅保存").click() })
    expect(document.body.textContent).toContain("save unavailable")
    await act(async () => { button("保存并启用").click() })
    expect(api.create.mock.calls[1][0].enabled).toBe(true)
    expect(api.update).not.toHaveBeenCalled()
  })
  it("ignores late draft-name loading after the automation has already been saved", async () => {
    let finishNames!: (items: AutomationItem[]) => void
    api.list.mockReturnValueOnce(new Promise<AutomationItem[]>(resolve => { finishNames = resolve }))
    await renderEditor(); await configure()
    await act(async () => { button("仅保存").click() })
    await act(async () => { finishNames([]) })
    await act(async () => { button("仅保存").click() })
    expect(api.create).toHaveBeenCalledTimes(1)
    expect(api.update).toHaveBeenCalledWith(expect.objectContaining({ id: "automation:1" }))
  })
  it("ignores a stale focus reload that completes after saving newer changes", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("下一步").click() })
    let finishReload!: (item: AutomationItem) => void
    api.get.mockReturnValueOnce(new Promise<AutomationItem>(resolve => { finishReload = resolve }))
    await act(async () => { window.dispatchEvent(new Event("focus")) })
    api.update.mockResolvedValueOnce({ ...item(), name: "新配置" })
    await act(async () => { change(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')!, "新配置") })
    await act(async () => { button("仅保存").click() })
    await act(async () => { finishReload(item()) })
    expect(document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')!.value).toBe("新配置")
  })
  it("blocks repeated saves and navigation while a save is pending", async () => {
    let finishSave!: (item: AutomationItem) => void
    api.create.mockReturnValueOnce(new Promise<AutomationItem>(resolve => { finishSave = resolve }))
    const onBack = vi.fn()
    await renderEditor({ onBack }); await configure()
    await act(async () => { button("仅保存").click(); button("仅保存").click() })
    expect(api.create).toHaveBeenCalledTimes(1)
    const navigate = vi.fn()
    await act(async () => { await runAppNavigation(navigate) })
    expect(navigate).not.toHaveBeenCalled()
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="返回自动化列表"]')!.click() })
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => { finishSave(item()) })
    expect(button("仅保存").disabled).toBe(false)
  })
})
