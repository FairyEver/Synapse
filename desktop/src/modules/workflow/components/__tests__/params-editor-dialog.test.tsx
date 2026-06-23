/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ParamsEditorDialog } from "../params-editor-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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

describe("ParamsEditorDialog", () => {
  it("trims parameter names before saving workflow parameters", async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            { name: " topic ", type: "text", default: "hello" },
            { name: "count", type: "number", default: 3 },
            { name: "   ", type: "text", default: "ignored" },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    const saveButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith([
      { name: "topic", type: "text", default: "hello" },
      { name: "count", type: "number", default: 3 },
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("saves file and directory parameter defaults as resource refs", async () => {
    const onChange = vi.fn()
    const onClose = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            { name: "input_file", type: "file", default: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" } },
            { name: "input_dir", type: "directory", default: { kind: "local_path", entryType: "directory", path: "/tmp/work" } },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    const saveButton = [...document.body.querySelectorAll("button")]
      .find((button) => button.textContent === "保存")

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })

    expect(onChange).toHaveBeenCalledWith([
      { name: "input_file", type: "file", default: { kind: "local_path", entryType: "file", path: "/tmp/input.txt" } },
      { name: "input_dir", type: "directory", default: { kind: "local_path", entryType: "directory", path: "/tmp/work" } },
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
