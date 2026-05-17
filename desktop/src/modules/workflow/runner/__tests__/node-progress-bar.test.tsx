/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { NodeProgressBar } from "../node-progress-bar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("NodeProgressBar", () => {
  it("uses tokenized visible progress animation classes", async () => {
    const container = document.createElement("div")
    const root = createRoot(container)

    await act(async () => {
      root.render(<NodeProgressBar />)
    })

    const indicator = container.querySelector(".bg-primary")
    expect(indicator?.className).toContain("animate-[indeterminate-slide")
    expect(indicator?.getAttribute("style") ?? "").not.toContain("hsl(var(")

    act(() => {
      root.unmount()
    })
  })
})
