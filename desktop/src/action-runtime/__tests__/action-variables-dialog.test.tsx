// @vitest-environment jsdom
import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ActionPromptField } from "../action-prompt-field"
import { TriggerVariablesDialog } from "@/modules/automation/editor/trigger-variables-dialog"
import type { AutomationTriggerVariableDescriptor } from "../../../automation-trigger-packages/types.shared"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver

const variables: readonly AutomationTriggerVariableDescriptor[] = [
  { key: "trigger.triggeredAt", label: "触发时间", group: "trigger" },
  { key: "trigger.payload.subject", label: "主题", group: "event" },
  { key: "trigger.request.body", label: "请求 Body", group: "event", dynamic: true },
]
let root: Root
let host: HTMLDivElement
const writeText = vi.fn()
function button(name: string, scope: ParentNode = document) {
  const result = Array.from(scope.querySelectorAll<HTMLButtonElement>("button"))
    .find(el => el.getAttribute("aria-label") === name || el.textContent?.trim() === name)
  if (!result) throw new Error(`Missing button: ${name}`)
  return result
}
function inputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
}
function Harness({ title = "收到邮件", items = variables }: { title?: string; items?: readonly AutomationTriggerVariableDescriptor[] }) {
  const [value, setValue] = useState("前文选中后文")
  return <>
    <TriggerVariablesDialog triggerTitle={title} variables={items} />
    <ActionPromptField id="prompt" value={value} onChange={setValue} variables={items} triggerTitle={title} />
  </>
}
async function render(title?: string, items?: readonly AutomationTriggerVariableDescriptor[]) {
  await act(async () => root.render(<Harness title={title} items={items} />))
}
async function open(mode: "view" | "insert") {
  await act(async () => button(mode === "view" ? "查看触发变量" : "插入变量").click())
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
  expect(dialog).not.toBeNull()
  return dialog!
}

describe("shared automation variable window", () => {
  beforeEach(() => {
    host = document.createElement("div"); document.body.append(host); root = createRoot(host)
    writeText.mockReset().mockResolvedValue(undefined)
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } })
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ""
    vi.restoreAllMocks()
  })

  it("opens the catalog in a portal and copies without modifying the prompt or closing", async () => {
    await render()
    const dialog = await open("view")
    expect(host.contains(dialog)).toBe(false)
    expect(dialog.textContent).toContain("收到邮件")
    expect(dialog.textContent).toContain("{{trigger.payload.subject}}")
    expect(dialog.textContent).not.toContain("{{trigger.triggeredAt}}")
    await act(async () => button("复制 {{trigger.payload.subject}}", dialog).click())
    expect(writeText).toHaveBeenCalledWith("{{trigger.payload.subject}}")
    expect(document.querySelector('[role="dialog"]')).toBe(dialog)
    expect(document.querySelector<HTMLTextAreaElement>("#prompt")!.value).toBe("前文选中后文")
    expect(dialog.textContent).toContain("已复制")
  })

  it("replaces only the prompt selection and restores its caret after inserting", async () => {
    await render()
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
    prompt.focus(); prompt.setSelectionRange(2, 4)
    const dialog = await open("insert")
    expect(dialog.textContent).toContain("提示词")
    await act(async () => button("插入 {{trigger.payload.subject}}", dialog).click())
    expect(prompt.value).toBe("前文{{trigger.payload.subject}}后文")
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt))
    expect(prompt.selectionStart).toBe(29)
    expect(prompt.selectionEnd).toBe(29)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(writeText).not.toHaveBeenCalled()
  })

  it("restores the untouched prompt selection when cancelled with Escape", async () => {
    await render()
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
    prompt.focus(); prompt.setSelectionRange(2, 4)
    await open("insert")
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    await vi.waitFor(() => expect(document.activeElement).toBe(prompt))
    expect(prompt.value).toBe("前文选中后文")
    expect([prompt.selectionStart, prompt.selectionEnd]).toEqual([2, 4])
  })

  it("filters a group and can clear an empty search to access the complete catalog", async () => {
    await render()
    const dialog = await open("view")
    const search = dialog.querySelector<HTMLInputElement>('[aria-label="搜索变量"]')!
    await act(async () => inputValue(search, "no-such-variable"))
    expect(dialog.textContent).toContain("没有匹配变量")
    await act(async () => button("清除筛选", dialog).click())
    expect(dialog.textContent).toContain("{{trigger.triggeredAt}}")
    await act(async () => inputValue(search, "triggeredAt"))
    expect(dialog.textContent).toContain("触发时间")
    expect(dialog.textContent).not.toContain("{{trigger.payload.subject}}")
  })

  it("supports a whole dynamic value, normalizes a path and rejects malformed paths", async () => {
    await render("Webhook")
    const dialog = await open("view")
    await act(async () => button("设置 请求 Body", dialog).click())
    const path = dialog.querySelector<HTMLInputElement>('[aria-label="请求 Body 字段路径"]')!
    await act(async () => button("复制", dialog).click())
    expect(writeText).toHaveBeenLastCalledWith("{{trigger.request.body}}")
    await act(async () => inputValue(path, " .items.0.id "))
    await act(async () => button("复制", dialog).click())
    expect(writeText).toHaveBeenLastCalledWith("{{trigger.request.body.items.0.id}}")
    await act(async () => inputValue(path, "items[0].id"))
    expect(button("复制", dialog).disabled).toBe(true)
    expect(path.getAttribute("aria-invalid")).toBe("true")
  })

  it("inserts a configured dynamic path using the same selection flow", async () => {
    await render("Webhook")
    const prompt = document.querySelector<HTMLTextAreaElement>("#prompt")!
    prompt.setSelectionRange(0, 6)
    const dialog = await open("insert")
    await act(async () => button("设置 请求 Body", dialog).click())
    await act(async () => inputValue(dialog.querySelector<HTMLInputElement>('[aria-label="请求 Body 字段路径"]')!, "order.id"))
    await act(async () => button("插入", dialog).click())
    expect(prompt.value).toBe("{{trigger.request.body.order.id}}")
  })

  it("previews sample values and distinguishes null, missing and invalid JSON for a literal key", async () => {
    await render("Webhook")
    const dialog = await open("view")
    await act(async () => button("设置 请求 Body", dialog).click())
    const path = dialog.querySelector<HTMLInputElement>('[aria-label="请求 Body 字段路径"]')!
    const sample = dialog.querySelector<HTMLTextAreaElement>('[aria-label="请求 Body 测试数据"]')!
    expect(sample).not.toBeNull()
    function setSample(value: string) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(sample, value)
      sample.dispatchEvent(new Event("input", { bubbles: true }))
    }
    await act(async () => { inputValue(path, "#/order.id"); setSample('{"order.id":0}') })
    expect(dialog.querySelector('[aria-label="预览值"]')?.textContent).toBe("0")
    await act(async () => setSample('{"order.id":null}'))
    expect(dialog.querySelector('[aria-label="预览值"]')?.textContent).toContain("null")
    await act(async () => setSample('{}'))
    expect(dialog.textContent).toContain("字段不存在")
    await act(async () => setSample('{broken'))
    expect(dialog.textContent).toContain("JSON 格式无效")
  })

  it("provides a selectable template when clipboard writing fails", async () => {
    writeText.mockRejectedValue(new Error("denied"))
    await render()
    const dialog = await open("view")
    await act(async () => button("复制 {{trigger.payload.subject}}", dialog).click())
    expect(dialog.textContent).toContain("复制失败")
    const fallback = dialog.querySelector<HTMLInputElement>('[aria-label="手动复制变量"]')!
    expect(fallback.value).toBe("{{trigger.payload.subject}}")
    expect(fallback.readOnly).toBe(true)
  })

  it("updates the source and hides entry points when no variables are supplied", async () => {
    await render()
    await render("Cron", [{ key: "trigger.cron", label: "Cron 表达式", group: "config" }])
    const dialog = await open("view")
    expect(dialog.textContent).toContain("Cron")
    expect(dialog.textContent).not.toContain("{{trigger.payload.subject}}")
    await act(async () => button("关闭", dialog).click())
    await render("手动", [])
    expect(host.querySelector('[aria-label="查看触发变量"]')).toBeNull()
    expect(Array.from(host.querySelectorAll("button")).some(el => el.textContent?.includes("插入变量"))).toBe(false)
  })
})
