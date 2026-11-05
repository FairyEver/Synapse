// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as cronUtils from "@/automation-triggers/cron-utils"
import { rendererActionRegistry } from "@/action-runtime/builtin-actions"
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
  return { schemaVersion: 2, runCount: 0, configVersion: 1, id: "automation:1", name: "每日构建", enabled: false, scope: { type: "global" },
    trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
    executor: { type: "builtin.agent", config: { projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "default", mode: "default", prompt: "echo ok", sessionPolicy: "fresh", timeoutMins: 30 } },
    policy: { missedRunPolicy: "skip", overlapPolicy: "skip" }, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z" }
}
const button = (text: string) => Array.from(document.querySelectorAll<HTMLButtonElement>('button, [role="menuitemradio"]')).find(b => b.textContent === text)!
function change(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
async function renderEditor(props: Record<string, unknown> = {}) {
  await act(async () => { root.render(<AutomationEditorForm {...{ mode: { mode: "create" as const }, onBack: vi.fn(), ...props }} />) })
}
async function configure() {
  await act(async () => { button("Cron").click() })
  await act(async () => { button("Agent").click() })
  await act(async () => { change(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")!, "echo ok") })
}
beforeEach(() => {
  Object.values(api).forEach(mock => mock.mockReset())
  vi.spyOn(rendererActionRegistry, "getDefaultConfig").mockImplementation(() => item().executor.config)
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  api.list.mockResolvedValue([]); api.get.mockResolvedValue(item()); api.create.mockResolvedValue(item()); api.update.mockResolvedValue(item())
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(window, "close").mockImplementation(() => undefined)
})
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks(); vi.restoreAllMocks() })
describe("inline automation editing", () => {
  it("expands the invalid executor and focuses the prompt after the view settles", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { change(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")!, "") })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="收起执行配置"]')!.click() })
    await act(async () => { button("仅保存").click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")!
    expect(prompt.getAttribute("aria-invalid")).toBe("true")
    expect(document.activeElement).toBe(prompt)
    expect(document.getElementById(prompt.getAttribute("aria-describedby")!)).not.toBeNull()
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="收起执行配置"]')!.click() })
    await act(async () => { button("仅保存").click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.activeElement).toBe(prompt)
    expect(prompt.closest('[data-slot="collapsible-content"]')?.getAttribute("data-state")).toBe("open")
  })
  it("passes the saved conditions through the editor into the Cron preview", async () => {
    const value = item()
    value.conditions = { operator: "and", items: [{ type: "weekdays", days: [1] }] }
    api.get.mockResolvedValueOnce(value)
    const compute = vi.spyOn(cronUtils, "listNextCronRuns")
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("未来 5 次").click() })
    expect(compute).toHaveBeenCalledWith("0 9 * * *", expect.any(Date), 5, { timezone: undefined, conditions: value.conditions })
  })
  it("keeps trigger and executor configurations together with actions in the scrolling form", async () => {
    await renderEditor()
    expect(document.body.textContent).toContain("当以下情况发生时")
    expect(button("Agent").disabled).toBe(true)
    await act(async () => { button("Cron").click() })
    await act(async () => { button("Agent").click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
    await act(async () => { change(document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!, "echo retained") })
    expect(button("仅保存").closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
    expect(document.querySelector('footer')).toBeNull()
    expect(button("下一步")).toBeUndefined()
  })
  it("rejects an invalid trigger when saving the combined configuration", async () => {
    await renderEditor()
    await act(async () => { button("固定间隔").click() })
    await act(async () => { button("Agent").click() })
    await act(async () => { change(document.querySelector<HTMLInputElement>('#automation-trigger-interval-minutes')!, "0") })
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })
  it("checks Cron syntax on save", async () => {
    await renderEditor(); await configure()
    await act(async () => { change(document.querySelector<HTMLInputElement>('#automation-trigger-cron-expr')!, "70 9 * * *") })
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
  })
  it("opens a type menu from the node heading and retains the selected configuration", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    expect(button("取消更换")).toBeUndefined()
    await act(async () => { document.querySelector<HTMLElement>('[role="menuitemradio"][data-state="checked"]')!.click() })
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
    expect(button("仅保存").disabled).toBe(false)
  })
  it("requires replacing variables that belong to the previous trigger", async () => {
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { change(document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!, "echo {{trigger.cron}}") })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    await act(async () => { button("固定间隔").click() })
    await act(async () => { button("确认更换").click() })
    expect(document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!.value).toBe("echo {{trigger.cron}}")
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("trigger.cron")
    expect(api.update).not.toHaveBeenCalled()
  })
  it("preserves existing runtime variables that are not listed in the trigger picker", async () => {
    const value = item()
    value.trigger = { type: "builtin.webhook", config: { webhookPublicId: "hook-1" } }
    value.executor.config.prompt = "echo {{trigger.request.remoteAddress}}"
    api.get.mockResolvedValueOnce(value)
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { button("仅保存").click() })
    expect(api.update).toHaveBeenCalledOnce()
  })
  it("checks an Agent prompt variable when its trigger was replaced", async () => {
    const value = item()
    value.trigger = { type: "builtin.webhook", config: { webhookPublicId: "hook-1" } }
    value.executor.config.prompt = "source={{trigger.request.body.id}}"
    api.get.mockResolvedValueOnce(value)
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    await act(async () => { button("Cron").click() })
    await act(async () => { button("确认更换").click() })
    await act(async () => { button("仅保存").click() })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("trigger.request.body.id")
    expect(api.update).not.toHaveBeenCalled()
  })
  it.each([
    ["builtin.agent", "task-action-agent-prompt"],
    ["builtin.claude-code", "task-action-claude-code-prompt"],
  ])("expands and focuses the %s prompt containing a replaced trigger variable", async (executorType, promptId) => {
    const value = item()
    value.trigger = { type: "builtin.webhook", config: { webhookPublicId: "hook-1" } }
    value.executor = { type: executorType, config: executorType === "builtin.agent"
      ? { ...value.executor.config, prompt: "source={{trigger.request.body.订单.项目.0.编号}}" }
      : { projectId: "project-1", prompt: "source={{trigger.request.body.订单.项目.0.编号}}", singleRun: true } }
    api.get.mockResolvedValueOnce(value)
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" } })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="更换触发条件"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
    await act(async () => { button("Cron").click() })
    await act(async () => { button("确认更换").click() })
    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="收起执行配置"]')!.click() })
    await act(async () => { button("仅保存").click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const prompt = document.getElementById(promptId)!
    expect(prompt.getAttribute("aria-invalid")).toBe("true")
    expect(document.activeElement).toBe(prompt)
    expect(document.getElementById(prompt.getAttribute("aria-describedby")!)?.textContent).toContain("trigger.request.body.订单.项目.0.编号")
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
      const name = document.querySelector<HTMLInputElement>('input[aria-label="自动化名称"]')
    expect(name).not.toBeNull()
    await act(async () => { change(name!, "新的名称") })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    await act(async () => { button("仅保存").click() })
    expect(api.update.mock.calls[0][0].patch.name).toBe("新的名称")
    expect(api.update.mock.calls[0][0].patch).not.toHaveProperty("enabled")
  })
  async function requestLeave(kind: "back" | "navigation" | "close", navigate = vi.fn()) {
    let pending: Promise<boolean> | undefined
    await act(async () => {
      if (kind === "back") document.querySelector<HTMLButtonElement>('[aria-label="返回自动化列表"]')!.click()
      else if (kind === "navigation") pending = runAppNavigation(navigate)
      else window.dispatchEvent(new Event("beforeunload", { cancelable: true }))
    })
    return { pending, navigate }
  }
  it("asks in a dialog and discards changes without stashing when returning", async () => {
    const onBack = vi.fn()
    await renderEditor({ onBack }); await configure()
    await requestLeave("back")
    const dialog = document.querySelector('[role="alertdialog"]')!
    expect(dialog).not.toBeNull()
    expect(document.querySelector('[role="region"][aria-label="未保存的更改"]')).toBeNull()
    expect(Array.from(dialog.querySelectorAll("button")).map(b => b.textContent)).toEqual(["继续编辑", "放弃", "保存"])
    expect(onBack).not.toHaveBeenCalled()
    await act(async () => { button("放弃").click() })
    expect(onBack.mock.calls).toEqual([[]])
    expect(api.create).not.toHaveBeenCalled()
  })
  it.each(["back", "navigation", "close"] as const)("saves before completing a pending %s", async kind => {
    let finishSave!: (value: AutomationItem) => void
    api.create.mockReturnValueOnce(new Promise<AutomationItem>(resolve => { finishSave = resolve }))
    const onBack = vi.fn(), onSaved = vi.fn()
    await renderEditor({ onBack, onSaved }); await configure()
    const { pending, navigate } = await requestLeave(kind)
    await act(async () => { button("保存").click(); button("保存").click() })
    expect(api.create).toHaveBeenCalledOnce()
    expect(api.create.mock.calls[0][0].enabled).toBe(false)
    expect(onBack).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(window.close).not.toHaveBeenCalled()
    expect(button("放弃").disabled).toBe(true)
    await act(async () => { finishSave(item()); await pending })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(onBack).toHaveBeenCalledTimes(kind === "back" ? 1 : 0)
    expect(navigate).toHaveBeenCalledTimes(kind === "navigation" ? 1 : 0)
    expect(window.close).toHaveBeenCalledTimes(kind === "close" ? 1 : 0)
    expect(onSaved).not.toHaveBeenCalled()
  })
  it("finishes the original navigation after saving even when a second request arrives during the save", async () => {
    let finishSave!: (value: AutomationItem) => void
    api.create.mockReturnValueOnce(new Promise<AutomationItem>(resolve => { finishSave = resolve }))
    await renderEditor(); await configure()
    const { pending, navigate } = await requestLeave("navigation")
    await act(async () => { button("保存").click() })
    const secondNavigate = vi.fn()
    await act(async () => { expect(await runAppNavigation(secondNavigate)).toBe(false) })
    await act(async () => { finishSave(item()); await pending })
    expect(navigate).toHaveBeenCalledOnce()
    expect(secondNavigate).not.toHaveBeenCalled()
  })
  it.each(["navigation", "close"] as const)("discards without saving before completing %s", async kind => {
    await renderEditor(); await configure()
    const { pending, navigate } = await requestLeave(kind)
    await act(async () => { button("放弃").click(); await pending })
    expect(navigate).toHaveBeenCalledTimes(kind === "navigation" ? 1 : 0)
    expect(window.close).toHaveBeenCalledTimes(kind === "close" ? 1 : 0)
    expect(api.create).not.toHaveBeenCalled()
  })
  it("keeps the dialog and input after a failed save and permits retrying the pending navigation", async () => {
    api.create.mockRejectedValueOnce(new Error("save unavailable"))
    await renderEditor(); await configure()
    const { pending, navigate } = await requestLeave("navigation")
    await act(async () => { button("保存").click() })
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toContain("save unavailable")
    expect(navigate).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('#task-action-agent-prompt')!.value).toBe("echo ok")
    await act(async () => { button("保存").click(); await pending })
    expect(navigate).toHaveBeenCalledOnce()
  })
  it("keeps incomplete configuration on validation failure and lets Escape resume editing", async () => {
    await renderEditor()
    await act(async () => { button("Cron").click() })
    const focusTarget = document.querySelector<HTMLInputElement>('[aria-label="自动化名称"]')!
    focusTarget.focus()
    const { pending, navigate } = await requestLeave("navigation")
    await act(async () => { button("保存").click() })
    expect(document.querySelector('[role="alertdialog"] [role="alert"]')?.textContent).toBeTruthy()
    expect(api.create).not.toHaveBeenCalled()
    await act(async () => {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))
      await pending
    })
    // Radix restores focus on the next task after unmounting the dialog.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) })
    expect(document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(navigate).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(focusTarget)
    expect(document.querySelector('#automation-trigger-cron-expr')).not.toBeNull()
  })
  it("preserves an enabled automation's status when saving before returning", async () => {
    api.get.mockResolvedValueOnce({ ...item(), enabled: true })
    const onBack = vi.fn()
    await renderEditor({ mode: { mode: "edit", automationId: "automation:1" }, onBack })
    await act(async () => { change(document.querySelector<HTMLInputElement>('[aria-label="自动化名称"]')!, "新名称") })
    await requestLeave("back")
    await act(async () => { button("保存").click() })
    expect(api.update.mock.calls[0][0]).toEqual({ id: "automation:1", patch: expect.objectContaining({ name: "新名称" }) })
    expect(api.update.mock.calls[0][0].patch).not.toHaveProperty("enabled")
    expect(onBack).toHaveBeenCalledOnce()
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
