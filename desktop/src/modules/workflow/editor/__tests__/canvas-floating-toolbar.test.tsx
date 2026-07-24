/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition, WorkflowParamPresetValue } from "@/types/workflow"
import { CanvasFloatingToolbar } from "../canvas-floating-toolbar"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let latestLastValues: unknown

vi.mock("../../components/run-params-dialog", () => ({
  RunParamsDialog: ({
    open,
    lastValues,
    onConfirm,
  }: {
    open: boolean
    lastValues?: unknown
    onConfirm: (
      values: Record<string, unknown>,
      rawValues: Record<string, WorkflowParamPresetValue>,
    ) => Promise<void>
  }) => {
    latestLastValues = lastValues
    return open ? (
      <button
        type="button"
        onClick={() => void onConfirm(
          { input: { kind: "file", path: "/missing.txt" } },
          { input: "/missing.txt" },
        )}
      >
        确认运行
      </button>
    ) : null
  },
}))

const definition: WorkflowDefinition = {
  id: "workflow-1",
  name: "Workflow",
  version: "v1",
  createdAt: 0,
  updatedAt: 0,
  layoutDirection: "horizontal" as const,
  params: [{ name: "input", type: "file", default: null }],
  nodes: [],
  edges: [],
}

const roots: Root[] = []

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.innerHTML = ""
  latestLastValues = undefined
  vi.clearAllMocks()
})

describe("CanvasFloatingToolbar", () => {
  it("remembers run parameters only after a run starts", async () => {
    const onRun = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce("run-1")
    const root = createRoot(document.body.appendChild(document.createElement("div")))
    roots.push(root)

    await act(async () => {
      root.render(
        <CanvasFloatingToolbar
          definition={definition}
          onSave={vi.fn()}
          onRun={onRun}
        />,
      )
    })
    await clickButton("运行")
    await clickButton("确认运行")

    expect(latestLastValues).toBeUndefined()
    expect(document.body.textContent).toContain("确认运行")

    await clickButton("确认运行")

    expect(latestLastValues).toEqual({
      values: { input: "/missing.txt" },
      resourceEntryTypes: { input: "file" },
    })
    expect(document.body.textContent).not.toContain("确认运行")
  })
})

async function clickButton(text: string): Promise<void> {
  const button = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((item) => item.textContent?.trim() === text)
  if (!button) throw new Error(`Button not found: ${text}`)
  await act(async () => {
    button.click()
    await Promise.resolve()
  })
}
