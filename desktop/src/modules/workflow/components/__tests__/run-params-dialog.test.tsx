/**
 * @vitest-environment jsdom
 */
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { RunParamsDialog } from "../run-params-dialog"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  track: vi.fn(),
  presetList: vi.fn(),
  presetSave: vi.fn(),
  presetDelete: vi.fn(),
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
  delete (window as unknown as { synapse?: unknown }).synapse
  vi.clearAllMocks()
})

function installBridge() {
  ;(window as unknown as { synapse: unknown }).synapse = {
    workflowParamPresets: {
      list: mocks.presetList,
      save: mocks.presetSave,
      delete: mocks.presetDelete,
    },
  }
}

async function renderDialog(props: Partial<ComponentProps<typeof RunParamsDialog>> = {}) {
  installBridge()
  mocks.presetList.mockResolvedValue([])
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
  await act(async () => {
    await Promise.resolve()
  })
  return { onConfirm, onCancel }
}

describe("RunParamsDialog", () => {
  it("tracks parameterized run submits without recording parameter values", async () => {
    installBridge()
    mocks.presetList.mockResolvedValue([])
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
    document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    await act(async () => {
      document.body.querySelector<HTMLElement>('[role="option"]')?.click()
    })

    expect(document.body.querySelector<HTMLInputElement>("#topic")?.value).toBe("secret preset")
    expect(document.body.querySelector<HTMLInputElement>("#count")?.value).toBe("9")
  })

  it("saves a new preset before running and does not track parameter values", async () => {
    mocks.presetSave.mockResolvedValue({ id: "preset-2", workflowId: "workflow-1", name: "新预设", values: { topic: "secret" }, createdAt: 1, updatedAt: 1 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      document.body.querySelector<HTMLInputElement>("#topic")!.value = "secret"
      document.body.querySelector<HTMLInputElement>("#topic")!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存为预设并运行")?.click()
    })
    const nameInput = document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')
    expect(nameInput?.value).toMatch(/^新预设 /)
    await act(async () => {
      nameInput!.value = "新预设"
      nameInput!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存并运行")?.click()
    })

    expect(mocks.presetSave).toHaveBeenCalledWith({ workflowId: "workflow-1", name: "新预设", values: { topic: "secret", count: "3" } })
    expect(onConfirm).toHaveBeenCalledWith({ topic: "secret", count: 3 }, { topic: "secret", count: "3" })
    expect(JSON.stringify(mocks.track.mock.calls)).not.toContain("secret")
  })

  it("requires overwrite confirmation for duplicate preset names", async () => {
    const duplicate = new Error("Preset name already exists")
    mocks.presetSave.mockRejectedValueOnce(duplicate)
    mocks.presetSave.mockResolvedValueOnce({ id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret" }, createdAt: 1, updatedAt: 2 })
    const { onConfirm } = await renderDialog()

    await act(async () => {
      document.body.querySelector<HTMLInputElement>("#topic")!.value = "secret"
      document.body.querySelector<HTMLInputElement>("#topic")!.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存为预设并运行")?.click()
    })
    await act(async () => {
      const input = document.body.querySelector<HTMLInputElement>('input[aria-label="预设名称"]')!
      input.value = "课程"
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "保存并运行")?.click()
    })
    expect(document.body.textContent).toContain("覆盖预设？")

    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "覆盖并运行")?.click()
    })

    expect(mocks.presetSave).toHaveBeenLastCalledWith({ workflowId: "workflow-1", name: "课程", values: { topic: "secret", count: "3" }, overwritePresetId: "preset-1" })
    expect(onConfirm).toHaveBeenCalled()
  })

  it("deletes the selected preset without clearing the current form", async () => {
    mocks.presetList.mockResolvedValue([
      { id: "preset-1", workflowId: "workflow-1", name: "课程", values: { topic: "secret preset", count: "9" }, createdAt: 1, updatedAt: 2 },
    ])
    mocks.presetDelete.mockResolvedValue(undefined)
    await renderDialog()

    document.body.querySelector<HTMLButtonElement>('[role="combobox"]')?.click()
    await act(async () => {
      document.body.querySelector<HTMLElement>('[role="option"]')?.click()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "删除")?.click()
    })
    await act(async () => {
      ;[...document.body.querySelectorAll("button")].find((button) => button.textContent === "删除")?.click()
    })

    expect(mocks.presetDelete).toHaveBeenCalledWith("preset-1")
    expect(document.body.querySelector<HTMLInputElement>("#topic")?.value).toBe("secret preset")
  })
})
