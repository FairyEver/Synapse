/**
 * @vitest-environment jsdom
 */
import { toPng } from "html-to-image"
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  exportWorkflowViewportAsPng,
  workflowPngFileName,
} from "../workflow-image-export"

vi.mock("html-to-image", () => ({
  toPng: vi.fn(),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe("workflow image export", () => {
  it("exports the full node bounds as a white 2x PNG with logical padding", async () => {
    vi.mocked(toPng).mockResolvedValue("data:image/png;base64,workflow")
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {})
    const viewport = document.createElement("div")

    await exportWorkflowViewportAsPng({
      viewport,
      bounds: { x: 10, y: 20, width: 100, height: 50 },
      workflowName: "发布流程",
    })

    expect(toPng).toHaveBeenCalledWith(viewport, {
      backgroundColor: "white",
      height: 114,
      pixelRatio: 2,
      style: {
        height: "114px",
        transform: "translate(22px, 12px) scale(1)",
        width: "164px",
      },
      width: 164,
    })
    expect(clickSpy).toHaveBeenCalledTimes(1)
    expect(clickSpy.mock.contexts[0]).toMatchObject({
      download: "发布流程.png",
      href: "data:image/png;base64,workflow",
    })
  })

  it("uses a cross-platform safe workflow name for the PNG", () => {
    expect(workflowPngFileName(" Roadmap: Q3 / plan ")).toBe("Roadmap_ Q3 _ plan.png")
    expect(workflowPngFileName("   ")).toBe("workflow.png")
  })

  it("rejects unmeasured node bounds instead of creating a cropped image", async () => {
    await expect(exportWorkflowViewportAsPng({
      viewport: document.createElement("div"),
      bounds: { x: 0, y: 0, width: 0, height: 40 },
      workflowName: "Workflow",
    })).rejects.toThrow("Workflow nodes are not ready for image export.")

    expect(toPng).not.toHaveBeenCalled()
  })
})
