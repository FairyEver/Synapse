/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RunParamsDialog } from "../run-params-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui-tracking")>()
  return {
    ...actual,
    track: mocks.track,
  }
})

let roots: Root[] = []

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("RunParamsDialog", () => {
  it("tracks parameterized run submits without recording parameter values", async () => {
    const onConfirm = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <RunParamsDialog
          open
          params={[
            { name: "topic", type: "text", default: "secret prompt value" },
            { name: "count", type: "number", default: 3 },
          ]}
          lastValues={{ topic: "last secret value", count: "7" }}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
    })

    const form = document.body.querySelector("form")
    expect(form).toBeDefined()

    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith(
      { topic: "last secret value", count: 7 },
      { topic: "last secret value", count: "7" },
    )
    expect(mocks.track).toHaveBeenCalledWith({
      component: "workflow",
      name: "workflow-run-params-submit",
      action: "submit",
      metadata: {
        boundary: "renderer.workflow.run-params.submit",
        paramCount: 2,
        numberParamCount: 1,
        textParamCount: 1,
        hasLastValues: true,
      },
    })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret")
  })
})
