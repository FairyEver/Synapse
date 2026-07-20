// @vitest-environment jsdom

import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import { WorkflowActionResultView } from "../result.renderer"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("WorkflowActionResultView", () => {
  afterEach(() => {
    document.body.innerHTML = ""
    vi.clearAllMocks()
  })

  it("opens workflow runner for workflow outputs", async () => {
    const openRunner = vi.fn(async () => undefined)
    ;(window as unknown as { synapse: { workflow: { operation: { openRunner: typeof openRunner } } } }).synapse = {
      workflow: { operation: { openRunner } },
    }
    const host = document.createElement("div")
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(<WorkflowActionResultView result={{
        status: "success",
        summary: "工作流完成：每日汇总",
        outputs: {
          workflowId: "wf-1",
          workflowName: "每日汇总",
          workflowRunId: "run-1",
          workflowStatus: "completed",
          output: "done",
        },
      }} />)
    })

    const button = host.querySelector("button")
    expect(button?.textContent).toContain("打开运行记录")
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
    expect(openRunner).toHaveBeenCalledWith("wf-1", "run-1")
  })
})
