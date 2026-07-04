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
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
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
  it("uses the compact product form layout", async () => {
    await renderDialog()

    const dialogContent = document.body.querySelector<HTMLElement>('[data-slot="dialog-content"]')
    expect(dialogContent?.className).toContain("sm:max-w-xl")
    expect(dialogContent?.className).not.toContain("sm:max-w-2xl")

    const presetLabel = [...document.body.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.textContent?.trim() === "预设")
    expect(presetLabel?.parentElement?.className).toContain("sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]")

    const topicLabel = [...document.body.querySelectorAll<HTMLLabelElement>("label")]
      .find((label) => label.textContent?.trim() === "topic")
    expect(topicLabel?.parentElement?.className).toContain("sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)]")
  })

  it("keeps the empty parameter state concise", async () => {
    await renderDialog({ params: [] })

    expect(document.body.textContent).toContain("无需参数")
    expect(document.body.textContent).not.toContain("此工作流无需参数。")
  })

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
        optionParamCount: 0,
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

  it("submits a selected closed option value", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", "周报"], allowCustomOption: false },
      ],
    })

    await act(async () => {
      setSelectValue(document.body.querySelector<HTMLSelectElement>("#report_type"), "周报")
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "周报" }, { report_type: "周报" })
    expect(mocks.track).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        optionParamCount: 1,
      }),
    }))
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("周报")
  })

  it("accepts a typed custom option value", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
      ],
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#report_type")?.click()
    })
    await act(async () => {
      setControlValue(document.body.querySelector<HTMLInputElement>('input[aria-label="report_type"]'), "季度复盘")
    })
    await act(async () => {
      const trigger = document.body.querySelector<HTMLButtonElement>("#report_type")
      expect(trigger).toBeTruthy()
      Object.defineProperty(trigger, "innerText", { configurable: true, value: "季度复盘" })
      trigger?.click()
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "季度复盘" }, { report_type: "季度复盘" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("季度复盘")
  })

  it("shows all custom-enabled option choices when a default value is selected", async () => {
    await renderDialog({
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", "周报"], allowCustomOption: true },
      ],
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#report_type")?.click()
    })

    const options = [...document.body.querySelectorAll<HTMLElement>('[role="option"]')]
      .map((option) => option.textContent?.trim())
    expect(options).toContain("日报")
    expect(options).toContain("周报")
  })

  it("does not track selected custom-enabled option values", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
      ],
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#report_type")?.click()
    })
    await act(async () => {
      clickOption("日报")
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "日报" }, { report_type: "日报" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("日报")
  })

  it("does not track populated custom option trigger values", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
      ],
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#report_type")?.click()
    })
    await act(async () => {
      clickOption("日报")
    })
    await act(async () => {
      const trigger = document.body.querySelector<HTMLButtonElement>("#report_type")
      expect(trigger).toBeTruthy()
      Object.defineProperty(trigger, "innerText", { configurable: true, value: "日报" })
      trigger?.click()
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "日报" }, { report_type: "日报" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("日报")
  })

  it("rejects a closed option value outside the option list", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", "周报"], allowCustomOption: false },
      ],
      lastValues: { report_type: "季度复盘" },
    })

    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("请选择预设选项")
  })

  it("falls back to the default when a defaulted option value is blank", async () => {
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: "日报", options: ["日报", "周报"], allowCustomOption: false },
      ],
      lastValues: { report_type: "" },
    })

    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "日报" }, { report_type: "" })
  })

  it("loads preset custom option values unchanged", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "季度", values: { report_type: "季度复盘" }, createdAt: 1, updatedAt: 2 },
    ])
    const { onConfirm } = await renderDialog({
      params: [
        { name: "report_type", type: "option", default: null, options: ["日报"], allowCustomOption: true },
      ],
    })

    await act(async () => {
      document.body.querySelector<HTMLButtonElement>("#workflow-run-param-preset")?.click()
    })
    await act(async () => {
      clickOption("季度")
    })
    await act(async () => {
      document.body.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
    })

    expect(onConfirm).toHaveBeenCalledWith({ report_type: "季度复盘" }, { report_type: "季度复盘" })
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

function setSelectValue(control: HTMLSelectElement | null, value: string) {
  expect(control).toBeTruthy()
  const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set
  setter?.call(control, value)
  control?.dispatchEvent(new Event("change", { bubbles: true }))
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
