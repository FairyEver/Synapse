/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { RunParamsDialog } from "../run-params-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  toast: vi.fn(),
  toastError: vi.fn(),
  presetList: vi.fn(),
  presetSave: vi.fn(),
  presetDelete: vi.fn(),
  chooseParamFile: vi.fn(),
  chooseParamDirectory: vi.fn(),
}))

vi.mock("@/lib/ui-tracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ui-tracking")>()
  return {
    ...actual,
    track: mocks.track,
  }
})

vi.mock("sonner", () => ({
  toast: Object.assign(mocks.toast, { error: mocks.toastError }),
}))

let roots: Root[] = []

beforeEach(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false)
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = vi.fn()
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn()
  }
  mocks.presetList.mockResolvedValue([])
  mocks.presetSave.mockResolvedValue({
    id: "preset-saved",
    workflowId: "workflow-1",
    name: "运行预设",
    values: {},
    createdAt: 1,
    updatedAt: 1,
  })
  Object.defineProperty(window, "synapse", {
    configurable: true,
    value: {
      workflow: {
        chooseParamFile: mocks.chooseParamFile,
        chooseParamDirectory: mocks.chooseParamDirectory,
      },
      workflowParamPresets: {
        list: mocks.presetList,
        save: mocks.presetSave,
        delete: mocks.presetDelete,
      },
    },
  })
})

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
          workflowId="workflow-1"
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
        workflowId: "workflow-1",
        paramCount: 2,
        numberParamCount: 1,
        textParamCount: 1,
        fileParamCount: 0,
        directoryParamCount: 0,
        hasLastValues: true,
        selectedPresetId: undefined,
        savedPreset: false,
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
          workflowId="workflow-1"
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

  it("saves current values as a preset before running", async () => {
    const onConfirm = vi.fn()
    mocks.presetSave.mockResolvedValue({
      id: "preset-1",
      workflowId: "workflow-1",
      name: "周报",
      values: { topic: "draft" },
      createdAt: 1,
      updatedAt: 2,
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <RunParamsDialog
          open
          workflowId="workflow-1"
          params={[{ name: "topic", type: "text", default: "" }]}
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      )
    })

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLTextAreaElement>("#topic"), "draft")
    })

    await act(async () => {
      clickButton("保存为预设并运行")
    })

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>("#workflow-param-preset-name"), "周报")
      document.body.querySelector("#workflow-param-preset-name")?.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(mocks.presetSave).toHaveBeenCalledWith({
      workflowId: "workflow-1",
      name: "周报",
      values: { topic: "draft" },
      overwritePresetId: undefined,
    })
    expect(onConfirm).toHaveBeenCalledWith(
      { topic: "draft" },
      { topic: "draft" },
    )
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        workflowId: "workflow-1",
        selectedPresetId: "preset-1",
        savedPreset: true,
      }),
    }))
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("draft")
  })

  it("deletes the selected preset without clearing current form values", async () => {
    mocks.presetSave.mockResolvedValue({
      id: "preset-a",
      workflowId: "workflow-1",
      name: "常用",
      values: { topic: "preset topic" },
      createdAt: 1,
      updatedAt: 2,
    })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    roots.push(root)

    await act(async () => {
      root.render(
        <RunParamsDialog
          open
          workflowId="workflow-1"
          params={[{ name: "topic", type: "text", default: "" }]}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />,
      )
    })

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLTextAreaElement>("#topic"), "preset topic")
    })
    await act(async () => {
      clickButton("保存为预设并运行")
    })
    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>("#workflow-param-preset-name"), "常用")
      document.body.querySelector("#workflow-param-preset-name")?.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })
    await waitFor(() => mocks.presetSave.mock.calls.length === 1)
    await act(async () => {
      await mocks.presetSave.mock.results[0]?.value
      await Promise.resolve()
      await Promise.resolve()
    })
    await waitFor(() => document.body.querySelector<HTMLButtonElement>("[aria-label='删除预设']")?.disabled === false)

    expect(document.body.querySelector<HTMLTextAreaElement>("#topic")?.value).toBe("preset topic")

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[aria-label='删除预设']")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })

    expect(mocks.presetDelete).toHaveBeenCalledWith("preset-a")
    expect(document.body.querySelector<HTMLTextAreaElement>("#topic")?.value).toBe("preset topic")
  })
})

function setControlValue(control: HTMLInputElement | HTMLTextAreaElement | null, value: string) {
  expect(control).toBeTruthy()
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  setter?.call(control, value)
  control?.dispatchEvent(new Event("input", { bubbles: true }))
}

function clickButton(label: string) {
  const buttons = [...document.body.querySelectorAll<HTMLButtonElement>("button")]
  const button = buttons.find((item) => item.textContent?.trim() === label)
  expect(button).toBeTruthy()
  button?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return
    await act(async () => {
      await Promise.resolve()
    })
  }
  throw new Error("Timed out waiting for dialog update")
}
