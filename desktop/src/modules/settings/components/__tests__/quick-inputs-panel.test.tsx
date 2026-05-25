/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QuickInputsPanel } from "../quick-inputs-panel"
import type { SynapseQuickInput } from "@/types/config"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("QuickInputsPanel", () => {
  it("renders the empty state", async () => {
    const container = await renderPanel([])

    expect(container.textContent).toContain("还没有片段")
  })

  it("adds a multi-line quick input", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([], onSave)

    await clickButton(container, "新增")
    await setTextareaValue("第一行\n第二行")
    await clickDialogButton("添加")

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ content: "第一行\n第二行", directSend: true }),
    ])
  })

  it("blocks blank content", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([], onSave)

    await clickButton(container, "新增")
    await setTextareaValue("   ")
    await clickDialogButton("添加")

    expect(onSave).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("内容不能为空。")
  })

  it("edits an existing quick input", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "旧内容", directSend: false }], onSave)

    await clickButton(container, "编辑片段")
    await setTextareaValue("新内容")
    await clickDialogButton("保存")

    expect(onSave).toHaveBeenCalledWith([{ id: "quick-1", content: "新内容", directSend: false }])
  })

  it("edits the direct send setting", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "继续", directSend: true }], onSave)

    await clickButton(container, "编辑片段")
    expect(getDirectSendSwitch().getAttribute("aria-checked")).toBe("true")

    await clickDirectSendSwitch()
    await clickDialogButton("保存")

    expect(onSave).toHaveBeenCalledWith([{ id: "quick-1", content: "继续", directSend: false }])
  })

  it("toggles direct send from the list", async () => {
    const onSave = vi.fn(async () => true)
    await renderPanel([
      { id: "quick-1", content: "继续", directSend: true },
      { id: "quick-2", content: "整理", directSend: false },
    ], onSave)

    await clickListDirectSendSwitch("继续")

    expect(onSave).toHaveBeenCalledWith([
      { id: "quick-1", content: "继续", directSend: false },
      { id: "quick-2", content: "整理", directSend: false },
    ])
  })

  it("disables list direct send switches while saving", async () => {
    let resolveSave: ((value: boolean) => void) | null = null
    const onSave = vi.fn(() => new Promise<boolean>((resolve) => {
      resolveSave = resolve
    }))
    await renderPanel([{ id: "quick-1", content: "继续", directSend: true }], onSave)

    await clickListDirectSendSwitch("继续")

    expect(getListDirectSendSwitch("继续").hasAttribute("disabled")).toBe(true)

    await act(async () => {
      resolveSave?.(true)
      await Promise.resolve()
    })
  })

  it("pins an item to the top", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([
      { id: "quick-1", content: "第一条", directSend: false },
      { id: "quick-2", content: "第二条", directSend: true },
    ], onSave)

    const pinButtons = container.querySelectorAll('button[aria-label="置顶片段"]')
    await act(async () => {
      pinButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith([
      { id: "quick-2", content: "第二条", directSend: true },
      { id: "quick-1", content: "第一条", directSend: false },
    ])
  })

  it("deletes an existing quick input after confirmation", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "待删除", directSend: false }], onSave)

    await clickButton(container, "删除片段")
    await clickDialogButton("删除")

    expect(onSave).toHaveBeenCalledWith([])
  })
})

async function renderPanel(items: SynapseQuickInput[], onSave = vi.fn(async () => true)) {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(<QuickInputsPanel quickInputs={items} onSave={onSave} />)
  })

  return container
}

async function clickButton(container: HTMLElement, label: string) {
  const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
    ?? Array.from(container.querySelectorAll("button")).find((item) => item.textContent === label)
  expect(button).toBeTruthy()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

async function clickDialogButton(label: string) {
  const button = Array.from(document.body.querySelectorAll("button"))
    .find((item) => item.textContent === label)
  expect(button).toBeTruthy()
  await act(async () => {
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

async function setTextareaValue(value: string) {
  const textarea = document.body.querySelector<HTMLTextAreaElement>("textarea")
  expect(textarea).toBeTruthy()
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
    if (!setter) throw new Error("Textarea value setter not found")
    setter.call(textarea, value)
    textarea!.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}

function getDirectSendSwitch() {
  const control = document.body.querySelector<HTMLElement>('[role="switch"][aria-label="直接发送"]')
  expect(control).toBeTruthy()
  return control!
}

async function clickDirectSendSwitch() {
  const control = getDirectSendSwitch()
  await act(async () => {
    control.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}

function getListDirectSendSwitch(content: string) {
  const control = document.body.querySelector<HTMLElement>(`[role="switch"][aria-label="直接发送：${content}"]`)
  expect(control).toBeTruthy()
  return control!
}

async function clickListDirectSendSwitch(content: string) {
  const control = getListDirectSendSwitch(content)
  await act(async () => {
    control.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await Promise.resolve()
  })
}
