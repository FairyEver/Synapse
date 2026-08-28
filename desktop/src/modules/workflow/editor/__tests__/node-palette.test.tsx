/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

import "../../../../../workflow-nodes/register.renderer"
import { NodePalette } from "../node-palette"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("NodePalette", () => {
  it("does not offer the removed workflow file conversion node", () => {
    const html = renderToStaticMarkup(<NodePalette />)

    expect(html).toContain("Prompt")
    expect(html).toContain("模板生成文档")
    expect(html).not.toContain("文件转换")
  })

  it("lets keyboard users add a node from the palette", async () => {
    const onAddNode = vi.fn()
    const container = document.body.appendChild(document.createElement("div"))
    const root = createRoot(container)

    await act(async () => {
      root.render(<NodePalette onAddNode={onAddNode} />)
    })

    const textButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.trim() === "文本")
    expect(textButton).toBeDefined()

    await act(async () => {
      textButton?.focus()
      textButton?.click()
    })

    expect(document.activeElement).toBe(textButton)
    expect(onAddNode).toHaveBeenCalledWith("text")

    act(() => root.unmount())
    container.remove()
  })
})
