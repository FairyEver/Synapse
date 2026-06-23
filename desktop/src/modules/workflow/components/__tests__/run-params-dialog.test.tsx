/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
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
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn()
  }
  mocks.presetList.mockResolvedValue([])
  mocks.presetSave.mockResolvedValue({
    id: "preset-saved",
    workflowId: "workflow-1",
    name: "新预设",
    values: {},
    createdAt: 1,
    updatedAt: 1,
  })
  mocks.presetDelete.mockResolvedValue(undefined)
  installBridge()
})

afterEach(() => {
  for (const root of roots) {
    act(() => {
      root.unmount()
    })
  }
  roots = []
  document.body.innerHTML = ""
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

function installBridge() {
  ;(window as unknown as { synapse: unknown }).synapse = {
    workflow: {
      chooseParamFile: mocks.chooseParamFile,
      chooseParamDirectory: mocks.chooseParamDirectory,
    },
    workflowParamPresets: {
      list: mocks.presetList,
      save: mocks.presetSave,
      delete: mocks.presetDelete,
    },
  }
}

async function renderDialog(props: Partial<ComponentProps<typeof RunParamsDialog>> = {}) {
  const onConfirm = vi.fn(async () => undefined)
  const onCancel = vi.fn()
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
          { name: "topic", type: "text", default: "" },
          { name: "count", type: "number", default: 3 },
        ]}
        onConfirm={onConfirm}
        onCancel={onCancel}
        {...props}
      />,
    )
  })
  await flushPromises()
  return { onConfirm, onCancel }
}

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

    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
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

  it("loads workflow-scoped presets and applies a selected preset", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret preset", count: "9", stale: "ignored" }, createdAt: 1, updatedAt: 2 },
    ])
    await renderDialog()

    expect(mocks.presetList).toHaveBeenCalledWith("workflow-1")
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    })
    await act(async () => {
      clickOption("课程")
    })

    expect(document.body.querySelector<HTMLTextAreaElement>("#topic")?.value).toBe("secret preset")
    expect(document.body.querySelector<HTMLInputElement>("#count")?.value).toBe("9")
  })

  it("submits file and directory params as local path resource refs", async () => {
    const onConfirm = vi.fn()
    await renderDialog({
      params: [
        { name: "input_file", type: "file", default: null },
        { name: "input_dir", type: "directory", default: null },
      ],
      onConfirm,
    })

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>("#input_file"), "/tmp/input.txt")
      setControlValue(document.body.querySelector<HTMLInputElement>("#input_dir"), "/tmp/work")
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

  it("saves a new preset before running and does not track parameter values", async () => {
    mocks.presetSave.mockResolvedValue({ id: "preset-2", workflowId: "workflow-1", name: "新预设", values: { topic: "secret" }, createdAt: 1, updatedAt: 1 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLTextAreaElement>("#topic"), "secret")
    })
    await act(async () => {
      clickButton("保存为预设并运行")
    })
    const nameInput = document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')
    expect(nameInput?.value).toMatch(/^新预设 /)
    await act(async () => {
      setControlValue(nameInput, "新预设")
    })
    await act(async () => {
      clickButton("保存并运行")
    })

    expect(mocks.presetSave).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "新预设", values: { topic: "secret", count: "3" } })
    expect(onConfirm).toHaveBeenCalledWith({ topic: "secret", count: 3 }, { topic: "secret", count: "3" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret")
  })

  it("requires overwrite confirmation for duplicate preset names", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "old" }, createdAt: 1, updatedAt: 1 },
    ])
    mocks.presetSave.mockResolvedValueOnce({ id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret" }, createdAt: 1, updatedAt: 2 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      setControlValue(document.body.querySelector<HTMLTextAreaElement>("#topic"), "secret")
    })
    await act(async () => {
      clickButton("保存为预设并运行")
    })
    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]'), "课程")
    })
    await act(async () => {
      clickButton("保存并运行")
    })
    expect(document.body.textContent).toContain("覆盖预设？")

    await act(async () => {
      clickButton("覆盖并运行")
    })

    expect(mocks.presetSave).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "课程", values: { topic: "secret", count: "3" }, overwritePresetId: "preset-1" })
    expect(onConfirm).toHaveBeenCalled()
  })

  it("deletes the selected preset without clearing the current form", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret preset", count: "9" }, createdAt: 1, updatedAt: 2 },
    ])
    await renderDialog()

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    })
    await act(async () => {
      clickOption("课程")
    })
    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("[aria-label='删除预设']")?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
    })
    await act(async () => {
      clickButton("删除")
    })

    expect(mocks.presetDelete).toHaveBeenCalledWith("preset-1")
    expect(document.body.querySelector<HTMLTextAreaElement>("#topic")?.value).toBe("secret preset")
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

function clickOption(label: string) {
  const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
  const option = options.find((item) => item.textContent?.trim() === label)
  expect(option).toBeTruthy()
  option?.click()
}

async function flushPromises(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}
