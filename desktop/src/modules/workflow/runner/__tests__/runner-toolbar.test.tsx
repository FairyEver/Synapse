/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"

import type { WorkflowDefinition } from "@/types/workflow"
import { RunnerToolbar } from "../runner-toolbar"

const track = vi.hoisted(() => vi.fn())

vi.mock("@/lib/ui-tracking", () => ({
  extractLabel: () => "button",
  track,
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
  track.mockClear()
})

describe("RunnerToolbar", () => {
  it("tracks runner toolbar actions with stable names", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    const onCancel = vi.fn(async () => {})
    const onViewModeChange = vi.fn()

    await act(async () => {
      root.render(
        <RunnerToolbar
          definition={definition()}
          runState="running"
          viewMode="dag"
          onViewModeChange={onViewModeChange}
          onCancel={onCancel}
          onRerun={vi.fn(async () => {})}
          onOpenEditor={vi.fn()}
        />,
      )
    })

    const timelineButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("时间线"))
    const stopButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("停止"))
    expect(timelineButton).toBeInstanceOf(HTMLButtonElement)
    expect(stopButton).toBeInstanceOf(HTMLButtonElement)

    await act(async () => {
      timelineButton?.click()
      stopButton?.click()
    })

    expect(onViewModeChange).toHaveBeenCalledWith("timeline")
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-runner-view-timeline",
      action: "click",
    })
    expect(track).toHaveBeenCalledWith({
      component: "button",
      name: "workflow-runner-stop",
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
