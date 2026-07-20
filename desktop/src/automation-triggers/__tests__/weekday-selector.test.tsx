/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WeekdaySelector } from "../weekday-selector"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => root.unmount())
  }
  roots = []
  document.body.innerHTML = ""
})

describe("WeekdaySelector", () => {
  it("renders weekdays in product order with explicit checked states", async () => {
    await renderSelector([1, 3, 0])

    const checkboxes = Array.from(document.querySelectorAll<HTMLElement>('[role="checkbox"]'))
    expect(checkboxes.map((checkbox) => checkbox.getAttribute("aria-label"))).toEqual([
      "周一",
      "周二",
      "周三",
      "周四",
      "周五",
      "周六",
      "周日",
    ])
    expect(checkboxByLabel("周一").getAttribute("aria-checked")).toBe("true")
    expect(checkboxByLabel("周二").getAttribute("aria-checked")).toBe("false")
    expect(checkboxByLabel("周日").getAttribute("aria-checked")).toBe("true")

    const selectedItem = checkboxByLabel("周一").closest("label")
    const unselectedItem = checkboxByLabel("周二").closest("label")
    const selector = document.querySelector<HTMLElement>('[data-slot="weekday-selector"]')
    expect(selector?.className).toContain("grid-cols-4 gap-x-4 gap-y-2")
    expect(selectedItem?.dataset.state).toBe("checked")
    expect(selectedItem?.className).toContain("min-h-10")
    expect(selectedItem?.querySelector("svg")).not.toBeNull()
    expect(unselectedItem?.dataset.state).toBe("unchecked")
    expect(unselectedItem?.className).toContain("hover:bg-muted/50")
    expect(unselectedItem?.querySelector("svg")).toBeNull()
  })

  it("adds and removes weekdays with normalized output", async () => {
    const onValueChange = vi.fn()
    await renderSelector([1, 3, 0], onValueChange)

    await click(checkboxByLabel("周二"))
    expect(onValueChange).toHaveBeenLastCalledWith([1, 2, 3, 0])

    await click(checkboxByLabel("周三"))
    expect(onValueChange).toHaveBeenLastCalledWith([1, 0])
  })

  it("toggles from the full weekday item and keeps checkboxes keyboard reachable", async () => {
    const onValueChange = vi.fn()
    await renderSelector([1], onValueChange)

    const mondayCheckbox = checkboxByLabel("周一")
    const tuesdayLabel = checkboxByLabel("周二").closest("label")

    expect(mondayCheckbox.tabIndex).toBe(0)
    expect(tuesdayLabel).not.toBeNull()

    await click(tuesdayLabel)
    expect(onValueChange).toHaveBeenCalledWith([1, 2])
  })

  it("allows temporarily clearing all weekdays", async () => {
    const onValueChange = vi.fn()
    await renderSelector([1], onValueChange)

    await click(checkboxByLabel("周一"))
    expect(onValueChange).toHaveBeenCalledWith([])
  })
})

async function renderSelector(value: readonly number[], onValueChange = vi.fn()): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <WeekdaySelector
        id="active-days"
        aria-labelledby="active-days-label"
        value={value}
        onValueChange={onValueChange}
      />
    )
  })
}

function checkboxByLabel(label: string): HTMLElement {
  const checkbox = document.querySelector<HTMLElement>(`[role="checkbox"][aria-label="${label}"]`)
  if (!checkbox) throw new Error(`Checkbox not found: ${label}`)
  return checkbox
}

async function click(target: Element | null): Promise<void> {
  await act(async () => {
    target?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
  })
}
