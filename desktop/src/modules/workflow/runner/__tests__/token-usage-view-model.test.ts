import { describe, expect, it } from "vitest"
import type { NodeRunResult, WorkflowDefinition } from "@/types/workflow"
import {
  buildWorkflowTokenUsageTable,
  formatWorkflowCostCell,
  formatWorkflowTokenCell,
} from "../token-usage-view-model"

describe("workflow token usage view model", () => {
  it("builds rows sorted by startedAt and totals priced costs", () => {
    const table = buildWorkflowTokenUsageTable(definition(), {
      later: nodeResult({
        nodeId: "later",
        startedAt: 20,
        usage: { input_tokens: 10, output_tokens: 2 },
        usageCost: {
          modelName: "test-model",
          costCny: 0.014,
          costBreakdownCny: { input: 0.01, output: 0.004, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
          costCurrency: "CNY",
          priceKnown: true,
          estimatedCost: true,
        },
      }),
      earlier: nodeResult({
        nodeId: "earlier",
        startedAt: 10,
        usage: { input_tokens: 5, cache_read_input_tokens: 30 },
        usageCost: {
          modelName: "unknown-model",
          priceKnown: false,
          estimatedCost: false,
        },
      }),
      pending: { nodeId: "pending", status: "pending", input: { variables: {} } },
    })

    expect(table.rows.map((row) => row.nodeId)).toEqual(["earlier", "later"])
    expect(table.total).toMatchObject({
      input: 15,
      output: 2,
      cacheRead: 30,
      cacheWrite: 0,
      reasoning: 0,
      costCny: 0.014,
      pricedRows: 1,
      unpricedRows: 1,
      nodeCount: 2,
    })
    expect(table.showReasoning).toBe(false)
  })

  it("shows reasoning column when any row has reasoning tokens", () => {
    const table = buildWorkflowTokenUsageTable(definition(), {
      later: nodeResult({
        nodeId: "later",
        usage: { reasoning_output_tokens: 7 },
      }),
    })
    expect(table.showReasoning).toBe(true)
  })

  it("formats tokens and costs", () => {
    expect(formatWorkflowTokenCell(1234567)).toBe("1,234,567")
    expect(formatWorkflowCostCell({ costCny: 0.000123, priceKnown: true })).toBe("¥0.000123")
    expect(formatWorkflowCostCell({ priceKnown: false })).toBe("未定价")
    expect(formatWorkflowCostCell(undefined)).toBe("未定价")
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
      { id: "earlier", name: "Earlier", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "later", name: "Later", type: "prompt", position: { x: 0, y: 0 }, config: {} },
      { id: "pending", name: "Pending", type: "prompt", position: { x: 0, y: 0 }, config: {} },
    ],
    edges: [],
  }
}

function nodeResult(input: Partial<NodeRunResult> & Pick<NodeRunResult, "nodeId">): NodeRunResult {
  return {
    status: "success",
    input: { variables: {} },
    ...input,
  }
}
