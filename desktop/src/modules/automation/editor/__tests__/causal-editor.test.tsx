// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AutomationEditorForm } from "../editor-form"
import type { AutomationItem } from "@/types/automation"

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), runs: vi.fn() }))
vi.mock("@/lib/electron-bridge", () => ({
  requireBridgeDomain: () => ({ item: api }),
  requireSynapseBridge: () => ({ automation: { run: { list: api.runs } } }),
  getSynapseBridge: () => ({ automation: { item: { onChanged: () => () => undefined } } }),
}))
vi.mock("@/app-shell/config", () => ({ useAppConfig: () => ({ config: { global: { projects: [] } } }) }))
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver
let root: Root
const item: AutomationItem = {
  id: "automation:1", schemaVersion: 2, name: "每日巡检", enabled: false, scope: { type: "global" },
  trigger: { type: "builtin.cron", config: { expr: "0 9 * * *" } },
  executor: { type: "builtin.agent", config: { projectId: "project-1", agentType: "claude-code", providerId: "provider-1", modelTier: "default", mode: "default", prompt: "检查项目", sessionPolicy: "fresh" } },
  policy: { missedRunPolicy: "skip", overlapPolicy: "skip" }, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z", runCount: 0, configVersion: 1,
}
async function renderEditor(edit = true) {
  await act(async () => root.render(<AutomationEditorForm mode={edit ? { mode: "edit", automationId: item.id } : { mode: "create" }} onBack={vi.fn()} />))
}
function button(label: string) { return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(b => b.textContent === label || b.getAttribute("aria-label") === label)! }
function changePrompt(value: string) {
  const input = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")!
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
beforeEach(() => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container)
  api.get.mockResolvedValue(item); api.list.mockResolvedValue([]); api.runs.mockResolvedValue([])
  api.update.mockResolvedValue(item)
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.clearAllMocks() })

describe("causal automation configuration", () => {
  it("shows both configurations and a live summary without next/previous navigation", async () => {
    await renderEditor()
    expect(document.querySelector("#automation-trigger-cron-expr")).not.toBeNull()
    expect(document.querySelector("#task-action-agent-prompt")).not.toBeNull()
    expect(button("下一步")).toBeUndefined()
    expect(document.querySelector('[aria-label="流程摘要"]')?.textContent).toContain("Agent")
    expect(button("仅保存").closest('[data-slot="scroll-area-viewport"]')).not.toBeNull()
  })
  it("disables execution choices until a trigger has been selected", async () => {
    await renderEditor(false)
    expect(button("Agent").disabled).toBe(true)
    await act(async () => button("Cron").click())
    expect(button("Agent").disabled).toBe(false)
  })
  it("closes the type menu when the node heading is clicked again", async () => {
    await renderEditor()
    const trigger = button("更换触发条件")
    const click = () => { trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); trigger.click() }
    await act(async () => click())
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    await act(async () => click())
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })
  it("inserts a trigger variable at the prompt selection and preserves the surrounding text", async () => {
    await renderEditor()
    await act(async () => changePrompt("前文后文"))
    const prompt = document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")!
    prompt.focus(); prompt.setSelectionRange(2, 2)
    await act(async () => button("插入变量").click())
    await act(async () => button("插入 {{trigger.triggeredAt}}").click())
    expect(prompt.value).toBe("前文{{trigger.triggeredAt}}后文")
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt))
    const expectedPrompt = prompt.value
    await act(async () => button("仅保存").click())
    expect(api.update.mock.calls[0][0].patch.executor.config.prompt).toBe(expectedPrompt)
  })
  it("keeps edited configuration when a node is collapsed and reopened", async () => {
    await renderEditor()
    await act(async () => changePrompt("保留修改后的任务"))
    await act(async () => button("收起执行配置").click())
    expect(button("展开执行配置").getAttribute("aria-expanded")).toBe("false")
    await act(async () => button("展开执行配置").click())
    expect(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")?.value).toBe("保留修改后的任务")
  })
  it("uses the saved item for history while keeping the draft in the configuration tab", async () => {
    await renderEditor()
    await act(async () => changePrompt("未保存的任务"))
    const history = document.querySelector<HTMLButtonElement>('[role="tab"][data-state="inactive"]')!
    await act(async () => history.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
    expect(api.runs).toHaveBeenCalledWith(item.id, { limit: 100 })
    await act(async () => button("配置").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })))
    expect(document.querySelector<HTMLTextAreaElement>("#task-action-agent-prompt")?.value).toBe("未保存的任务")
  })
})
