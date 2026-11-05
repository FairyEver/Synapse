// @vitest-environment jsdom

import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { AutomationConditions as AutomationConditionsValue } from "@/types/automation"
import { AutomationConditions } from "../automation-conditions"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as typeof ResizeObserver

let root: Root | undefined

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("AutomationConditions", () => {
  it.each(["weekdays", "daily-time-range"] as const)("focuses the newly added %s control after the add menu closes", async type => {
    await renderConditions(type === "daily-time-range" ? { operator: "and", items: [{ type: "weekdays", days: [1] }] } : undefined)
    await act(async () => { openMenu(button("添加条件")) })
    await act(async () => { menuItem(type === "weekdays" ? "星期几" : "每天的时间段").click() })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    const target = document.querySelector(type === "weekdays" ? '[role="checkbox"][aria-label="周一"]' : '#automation-conditions-time-range')
    expect(document.activeElement).toBe(target)
  })

  it.each(["delete", "clear"] as const)("returns focus to add after removing the time condition through %s", async method => {
    await renderConditions({ operator: "and", items: [{ type: "weekdays", days: [1] }, { type: "daily-time-range", start: "08:00", end: "17:00" }] })
    if (method === "clear") {
      await act(async () => { document.querySelector<HTMLButtonElement>('#automation-conditions-time-range')!.click() })
      await act(async () => { button("不限时间").click() })
    } else {
      const remove = document.querySelector<HTMLButtonElement>('[aria-label="删除每天的时间段条件"]')!
      await act(async () => { remove.focus(); remove.click() })
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)) })
    expect(document.activeElement).toBe(button("添加条件"))
    expect(document.querySelector('#automation-conditions-time-range')).toBeNull()
  })

  it("returns focus to add after removing the last condition", async () => {
    await renderConditions({ operator: "and", items: [{ type: "weekdays", days: [1] }] })
    await act(async () => {
      const remove = document.querySelector<HTMLButtonElement>('[aria-label="删除星期几条件"]')!
      remove.focus(); remove.click()
    })
    expect(document.activeElement).toBe(button("添加条件"))
  })

  it("renders an empty condition card and adds available condition types", async () => {
    const onChange = await renderConditions()
    expect(document.body.textContent).toContain("并且符合以下条件")
    expect(document.body.textContent).toContain("添加条件")

    await act(async () => { openMenu(button("添加条件")) })
    await act(async () => { menuItem("星期几").click() })

    expect(onChange).toHaveBeenLastCalledWith({
      operator: "and",
      items: [{ type: "weekdays", days: [0, 1, 2, 3, 4, 5, 6] }],
    })
    expect(document.querySelectorAll('[role="checkbox"]')).toHaveLength(7)
  })

  it("switches the shared relation between and and or", async () => {
    const onChange = await renderConditions({
      operator: "and",
      items: [
        { type: "weekdays", days: [1, 2, 3, 4, 5] },
        { type: "daily-time-range", start: "08:00", end: "17:00" },
      ],
    })

    expect(button("并且")).not.toBeUndefined()
    await act(async () => { openMenu(button("并且")) })
    await act(async () => { menuItem("或者").click() })

    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ operator: "or" }))
    expect(document.body.textContent).toContain("或者符合以下条件")
  })

  it("removes a condition and shows an error when no weekday remains", async () => {
    const onChange = await renderConditions({
      operator: "and",
      items: [{ type: "weekdays", days: [1] }],
    })

    await act(async () => {
      document.querySelector<HTMLElement>('[role="checkbox"][aria-label="周一"]')?.click()
    })
    expect(onChange).toHaveBeenLastCalledWith({
      operator: "and",
      items: [{ type: "weekdays", days: [] }],
    })
    expect(document.body.textContent).toContain("至少选择一个星期")

    await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="删除星期几条件"]')!.click() })
    expect(onChange).toHaveBeenLastCalledWith(undefined)
  })
})

async function renderConditions(initial?: AutomationConditionsValue) {
  const onChange = vi.fn()
  function Host() {
    const [value, setValue] = useState(initial)
    return <AutomationConditions value={value} onChange={(next) => { onChange(next); setValue(next) }} />
  }
  const container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => { root!.render(<Host />) })
  return onChange
}

function button(text: string): HTMLButtonElement {
  const result = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
    .find((element) => element.textContent?.includes(text))
  expect(result).toBeDefined()
  return result!
}

function menuItem(text: string): HTMLElement {
  const result = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"]'))
    .find((element) => element.textContent === text)
  expect(result).toBeDefined()
  return result!
}

function openMenu(trigger: HTMLButtonElement) {
  trigger.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
  trigger.click()
}
