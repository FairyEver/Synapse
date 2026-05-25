/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { QuickInputsPanel } from "../quick-inputs-panel"
import type { SynapseQuickInput } from "@/types/config"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

    expect(container.textContent).toContain("还没有快速输入")
  })

  it("adds a multi-line quick input", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([], onSave)

    await clickButton(container, "新增")
    await setTextareaValue("第一行\n第二行")
    await clickDialogButton("添加")

    expect(onSave).toHaveBeenCalledWith([
      expect.objectContaining({ content: "第一行\n第二行" }),
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
    const container = await renderPanel([{ id: "quick-1", content: "旧内容" }], onSave)

    await clickButton(container, "编辑快速输入")
    await setTextareaValue("新内容")
    await clickDialogButton("保存")

    expect(onSave).toHaveBeenCalledWith([{ id: "quick-1", content: "新内容" }])
  })

  it("pins an item to the top", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([
      { id: "quick-1", content: "第一条" },
      { id: "quick-2", content: "第二条" },
    ], onSave)

    const pinButtons = container.querySelectorAll('button[aria-label="置顶快速输入"]')
    await act(async () => {
      pinButtons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onSave).toHaveBeenCalledWith([
      { id: "quick-2", content: "第二条" },
      { id: "quick-1", content: "第一条" },
    ])
  })

  it("deletes an existing quick input after confirmation", async () => {
    const onSave = vi.fn(async () => true)
    const container = await renderPanel([{ id: "quick-1", content: "待删除" }], onSave)

    await clickButton(container, "删除快速输入")
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
