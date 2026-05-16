/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"
import { WorkflowToolbar } from "../toolbar"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  track,
}))

vi.mock("../../components/params-editor-dialog", () => ({
  ParamsEditorDialog: () => null,
}))

vi.mock("../../components/run-params-dialog", () => ({
  RunParamsDialog: () => null,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
  track.mockClear()
})

describe("WorkflowToolbar", () => {
  it("tracks editor toolbar actions with stable names", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <WorkflowToolbar
          definition={definition()}
          projects={[]}
          onSave={vi.fn(async () => undefined)}
          onRun={vi.fn(async () => "run-1")}
          onChange={vi.fn()}
        />,
      )
    })

    await act(async () => {
      buttonByText(container, "参数").click()
      buttonByText(container, "保存").click()
      buttonByText(container, "运行").click()
    })

    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-editor-params",
      action: "click",
    })
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-editor-save",
      action: "click",
    })
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-editor-run",
      action: "click",
    })

    await act(async () => {
      root.unmount()
    })
  })
})

function definition(): WorkflowDefinition {
  return {
    id: "workflow-1",
    name: "Workflow",
    version: "1",
    createdAt: 0,
    updatedAt: 0,
    nodes: [],
    edges: [],
    params: [],
  }
}

function buttonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.includes(text))
  if (!button) throw new Error(`Button not found: ${text}`)
  return button
}
