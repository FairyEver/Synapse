/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ParamsEditorDialog } from "../params-editor-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
Element.prototype.scrollIntoView = vi.fn()

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
            { name: "input_file", type: "file", default: { kind: "local_path", entryType: "file", path: "/tmp/input.txt " } },
            { name: "input_dir", type: "directory", default: { kind: "local_path", entryType: "directory", path: "/tmp/work " } },
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
      { name: "input_file", type: "file", default: { kind: "local_path", entryType: "file", path: "/tmp/input.txt " } },
      { name: "input_dir", type: "directory", default: { kind: "local_path", entryType: "directory", path: "/tmp/work " } },
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("clears a single-resource default when multi-select is enabled", async () => {
    const onChange = vi.fn()
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
          ]}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      )
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="switch"]')?.click()
    })
    await act(async () => { clickButton("保存") })

    expect(onChange).toHaveBeenCalledWith([{
      name: "input_file",
      type: "file",
      allowMultiple: true,
      default: null,
    }])
  })

  it("clears a multi-resource default instead of taking its first item when multi-select is disabled", async () => {
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[{
            name: "input_files",
            type: "file",
            allowMultiple: true,
            default: [
              { kind: "local_path", entryType: "file", path: "/tmp/a.txt" },
              { kind: "local_path", entryType: "file", path: "/tmp/b.txt" },
            ],
          }]}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      )
    })

    const multipleSwitch = document.body.querySelector<HTMLButtonElement>('[role="switch"]')
    await act(async () => { multipleSwitch?.click() })
    expect(multipleSwitch?.getAttribute("aria-checked")).toBe("false")
    await act(async () => { clickButton("保存") })

    expect(onChange).toHaveBeenCalledWith([{
      name: "input_files",
      type: "file",
      default: null,
    }])
  })

  it("does not reinterpret incompatible stored default shapes", async () => {
    const onChange = vi.fn()
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <ParamsEditorDialog
          open
          params={[
            {
              name: "input_files",
              type: "file",
              allowMultiple: true,
              default: { kind: "local_path", entryType: "file", path: "/tmp/single.txt" },
            },
            {
              name: "input_file",
              type: "file",
              default: [{ kind: "local_path", entryType: "file", path: "/tmp/first.txt" }],
            },
          ]}
          onChange={onChange}
          onClose={vi.fn()}
        />,
      )
    })

    expect(document.body.textContent).not.toContain("/tmp/single.txt")
    expect(document.body.querySelector<HTMLInputElement>('input[value="/tmp/first.txt"]')).toBeNull()
    await act(async () => { clickButton("保存") })

    expect(onChange).toHaveBeenCalledWith([
      { name: "input_files", type: "file", allowMultiple: true, default: null },
      { name: "input_file", type: "file", default: null },
    ])
  })

  it("trims option values, drops empty options, and clears invalid option defaults", async () => {
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
            {
              name: "report_type",
              type: "option",
              default: "月报",
              options: [" 日报 ", "", "周报"],
              allowCustomOption: true,
            },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    await act(async () => {
      clickButton("保存")
    })

    expect(onChange).toHaveBeenCalledWith([
      {
        name: "report_type",
        type: "option",
        default: null,
        options: ["日报", "周报"],
        allowCustomOption: true,
      },
    ])
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("blocks saving option parameters when all options are empty", async () => {
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
            { name: "report_type", type: "option", default: null, options: [" "] },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    await act(async () => {
      clickButton("保存")
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("至少保留一个选项")
  })

  it("blocks saving duplicate option values after trimming", async () => {
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
            { name: "report_type", type: "option", default: null, options: ["日报", " 日报 "] },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    await act(async () => {
      clickButton("保存")
    })

    expect(onChange).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("选项不能重复")
  })

  it("shows option in the type selector", async () => {
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
            { name: "report_type", type: "text", default: null },
          ]}
          onChange={onChange}
          onClose={onClose}
        />,
      )
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    })

    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
    expect(options.some((option) => option.textContent?.trim() === "选项")).toBe(true)
  })
})

function clickButton(label: string) {
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
  const button = buttons.find((item) => item.textContent?.trim() === label)
  expect(button).toBeTruthy()
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}
