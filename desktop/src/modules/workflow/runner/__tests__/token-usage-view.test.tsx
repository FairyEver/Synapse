/**
 * @vitest-environment jsdom
 */
import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, describe, expect, it } from "vitest"
import type { WorkflowDefinition } from "@/types/workflow"
import { TokenUsageView } from "../token-usage-view"

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

afterEach(() => {
  document.body.innerHTML = ""
})

describe("TokenUsageView", () => {
  it("renders approved single table with footer totals and no summary cards", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <TokenUsageView
          definition={definition()}
          nodeResults={{
            "node-1": {
              nodeId: "node-1",
              status: "success",
              input: { variables: {} },
              startedAt: 10,
              usage: { input_tokens: 10, output_tokens: 2 },
              usageCost: {
                modelName: "test-model",
                costCny: 0.014,
                costBreakdownCny: { input: 0.01, output: 0.004, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
                costCurrency: "CNY",
                priceKnown: true,
                estimatedCost: true,
              },
            },
            "node-2": {
              nodeId: "node-2",
              status: "success",
              input: { variables: {} },
              startedAt: 20,
              usage: { input_tokens: 5, cache_read_input_tokens: 30 },
              usageCost: { modelName: "unknown-model", priceKnown: false, estimatedCost: false },
            },
          }}
        />,
      )
    })

    expect(container.textContent).toContain("Token 消耗")
    expect(container.textContent).toContain("Prompt node")
    expect(container.textContent).toContain("Unknown price node")
    expect(container.textContent).toContain("test-model")
    expect(container.textContent).toContain("unknown-model")
    expect(container.textContent).toContain("未定价")
    expect(container.textContent).toContain("合计")
    expect(container.textContent).toContain("2 个节点")
    expect(container.textContent).toContain("部分定价")
    expect(container.textContent).not.toContain("总费用")

    const rightAlignedCells = container.querySelectorAll(".text-right")
    expect(rightAlignedCells.length).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })
  })

  it("shows a compact empty state when no node has usage", async () => {
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(<TokenUsageView definition={definition()} nodeResults={{}} />)
    })

    expect(container.textContent).toContain("暂无 Token 消耗")

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
    layoutDirection: "horizontal" as const,
    params: [],
    nodes: [
      { id: "node-1", name: "Prompt node", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "node-2", name: "Unknown price node", type: "prompt", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
  }
}
