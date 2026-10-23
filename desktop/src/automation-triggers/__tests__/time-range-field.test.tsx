// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TimeRangeField } from "../time-range-field"
import type { AutomationTimeRange } from "../../../automation-trigger-packages/schedule-constraints"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver
HTMLElement.prototype.scrollIntoView = vi.fn()

let root: Root | undefined
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ""
})

describe("TimeRangeField", () => {
  it("shows a compact unrestricted trigger and does not save defaults just by opening", async () => {
    const onChange = await renderField()
    expect(document.querySelectorAll("input")).toHaveLength(0)
    expect(trigger().textContent).toContain("不限时间")
    await click(trigger())
    expect(picker("开始小时").textContent).toContain("08")
    expect(picker("结束小时").textContent).toContain("17")
    expect(onChange).not.toHaveBeenCalled()
    await click(popoverButton("不限时间"))
    expect(trigger().textContent).toContain("不限时间")
    expect(onChange).not.toHaveBeenCalled()
  })

  it("selects hours and minutes and commits one complete range on confirmation", async () => {
    const onChange = await renderField()
    await click(trigger())
    await select("开始小时", "09")
    await select("开始分钟", "15")
    await select("结束小时", "18")
    await select("结束分钟", "45")
    expect(onChange).not.toHaveBeenCalled()
    await click(popoverButton("确定"))
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ start: "09:15", end: "18:45" })
    expect(trigger().textContent).toContain("09:15")
    expect(trigger().textContent).toContain("18:45")
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  })

  it("discards an unconfirmed selection on Escape and reopens the saved range", async () => {
    const onChange = await renderField({ start: "08:20", end: "17:40" })
    await click(trigger())
    await select("开始小时", "09")
    await act(async () => { picker("开始小时").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })) })
    expect(onChange).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
    await click(trigger())
    expect(picker("开始小时").textContent).toContain("08")
    expect(picker("开始分钟").textContent).toContain("20")
  })

  it("allows 24:00 as an end time and fixes its minutes to zero", async () => {
    const onChange = await renderField({ start: "08:00", end: "17:45" })
    await click(trigger())
    await select("结束小时", "24")
    expect(picker("结束分钟").disabled).toBe(true)
    expect(picker("结束分钟").textContent).toContain("00")
    await click(popoverButton("确定"))
    expect(onChange).toHaveBeenLastCalledWith({ start: "08:00", end: "24:00" })
  })

  it("blocks reversed or equal ranges until corrected", async () => {
    const onChange = await renderField()
    await click(trigger())
    await select("开始小时", "18")
    expect(popoverButton("确定").disabled).toBe(true)
    expect(document.body.textContent).toContain("结束时间必须晚于开始时间")
    expect(onChange).not.toHaveBeenCalled()
    await select("结束小时", "18")
    expect(popoverButton("确定").disabled).toBe(true)
    await select("结束分钟", "01")
    expect(popoverButton("确定").disabled).toBe(false)
    await click(popoverButton("确定"))
    expect(onChange).toHaveBeenLastCalledWith({ start: "18:00", end: "18:01" })
  })

  it("clears an existing range to unrestricted hours", async () => {
    const onChange = await renderField({ start: "08:00", end: "17:00" })
    await click(trigger())
    await click(popoverButton("不限时间"))
    expect(onChange).toHaveBeenCalledExactlyOnceWith(undefined)
    expect(trigger().textContent).toContain("不限时间")
  })
})

async function renderField(initialValue?: AutomationTimeRange) {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState(initialValue)
    return <TimeRangeField id="test-range" value={value} onValueChange={(next) => { onChange(next); setValue(next) }} />
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Host />) })
  return onChange
}

function trigger(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>('#test-range')
  expect(element).not.toBeNull()
  return element!
}

function picker(label: string): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)
  expect(element).not.toBeNull()
  return element!
}

function popoverButton(text: string): HTMLButtonElement {
  const element = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-slot="popover-content"] button'))
    .find((button) => button.textContent === text)
  expect(element).toBeDefined()
  return element!
}

async function click(element: HTMLElement) {
  await act(async () => { element.click() })
}

async function select(label: string, value: string) {
  await act(async () => { picker(label).dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })) })
  const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]'))
    .find((element) => element.textContent === value)
  expect(option, `${label}: ${value}`).toBeDefined()
  await click(option!)
}
