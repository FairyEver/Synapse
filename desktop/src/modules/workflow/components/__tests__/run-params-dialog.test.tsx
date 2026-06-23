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
        fileParamCount: 0,
        directoryParamCount: 0,
        hasLastValues: true,
      },
    })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret")
  })

  it("submits file and directory params as local path resource refs", async () => {
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
            { name: "input_file", type: "file", default: null },
            { name: "input_dir", type: "directory", default: null },
          ]}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
    })

    const fileInput = document.body.querySelector<HTMLInputElement>("#input_file")
    const dirInput = document.body.querySelector<HTMLInputElement>("#input_dir")
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set

    await act(async () => {
      setter?.call(fileInput, "/tmp/input.txt")
      fileInput?.dispatchEvent(new Event("input", { bubbles: true }))
      setter?.call(dirInput, "/tmp/work")
      dirInput?.dispatchEvent(new Event("input", { bubbles: true }))
    })

    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith(
      {
        input_file: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" },
        input_dir: { kind: "local_path", entryType: "directory", path: "/tmp/work" },
      },
      {
        input_file: "/tmp/input.txt",
        input_dir: "/tmp/work",
      },
    )
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        fileParamCount: 1,
        directoryParamCount: 1,
      }),
    }))
  })
})
