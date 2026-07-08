/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

;(globalThis as typeof globalThis & { ResizeObserver: typeof ResizeObserver }).ResizeObserver = class ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as typeof ResizeObserver

HTMLElement.prototype.scrollIntoView = vi.fn()

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
})

describe("SelectContent", () => {
  it("uses popper positioning by default", async () => {
    await renderSelect()

    const content = document.querySelector<HTMLElement>('[data-slot="select-content"]')
    const viewport = content?.querySelector<HTMLElement>("[data-position]")

    expect(content?.dataset.alignTrigger).toBe("false")
    expect(viewport?.dataset.position).toBe("popper")
  })
})

async function renderSelect(): Promise<void> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  roots.push(root)

  await act(async () => {
    root.render(
      <Select open defaultValue="synapse">
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="synapse">Synapse</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    )
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}
