import { formatSynapseCost } from "@/lib/cost-currency"
import { formatTokenUsageValue, normalizeClaudeSdkUsage } from "@/lib/token-usage"
import type {
  NodeRunResult,
  WorkflowDefinition,
  WorkflowNodeUsageCostSnapshot,
} from "@/types/workflow"

export interface WorkflowTokenUsageRow {
  readonly nodeId: string
  readonly nodeName: string
  readonly modelName?: string
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly usageCost?: WorkflowNodeUsageCostSnapshot
  readonly startedAt?: number
  readonly orderIndex: number
}

export interface WorkflowTokenUsageTotal {
  readonly nodeCount: number
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly reasoning: number
  readonly costCny: number
  readonly pricedRows: number
  readonly unpricedRows: number
}

export interface WorkflowTokenUsageTable {
  readonly rows: readonly WorkflowTokenUsageRow[]
  readonly total: WorkflowTokenUsageTotal
  readonly showReasoning: boolean
}

export function buildWorkflowTokenUsageTable(
  definition: WorkflowDefinition,
  nodeResults: Record<string, NodeRunResult>,
): WorkflowTokenUsageTable {
  const order = new Map(definition.nodes.map((node, index) => [node.id, index]))
  const names = new Map(definition.nodes.map((node) => [node.id, node.name]))
  const rows = Object.values(nodeResults)
    .flatMap((result): WorkflowTokenUsageRow[] => {
      const usage = normalizeClaudeSdkUsage(result.usage)
      if (!usage) return []
      return [{
        nodeId: result.nodeId,
        nodeName: names.get(result.nodeId) ?? result.nodeId,
        modelName: result.usageCost?.modelName,
        input: usage.inputTokens,
        output: usage.outputTokens,
        cacheRead: usage.cacheReadInputTokens,
        cacheWrite: usage.cacheCreationInputTokens,
        reasoning: usage.reasoningOutputTokens ?? 0,
        usageCost: result.usageCost,
        startedAt: result.startedAt,
        orderIndex: order.get(result.nodeId) ?? Number.MAX_SAFE_INTEGER,
      }]
    })
    .sort(compareTokenRows)

  const total = rows.reduce<WorkflowTokenUsageTotal>((acc, row) => {
    const priced = row.usageCost?.priceKnown === true && typeof row.usageCost.costCny === "number"
    return {
      nodeCount: acc.nodeCount + 1,
      input: acc.input + row.input,
      output: acc.output + row.output,
      cacheRead: acc.cacheRead + row.cacheRead,
      cacheWrite: acc.cacheWrite + row.cacheWrite,
      reasoning: acc.reasoning + row.reasoning,
      costCny: priced ? roundCost(acc.costCny + (row.usageCost?.costCny ?? 0)) : acc.costCny,
      pricedRows: acc.pricedRows + (priced ? 1 : 0),
      unpricedRows: acc.unpricedRows + (priced ? 0 : 1),
    }
  }, {
    nodeCount: 0,
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
    costCny: 0,
    pricedRows: 0,
    unpricedRows: 0,
  })

  return {
    rows,
    total,
    showReasoning: rows.some((row) => row.reasoning > 0),
  }
}

export function formatWorkflowTokenCell(value: number): string {
  return formatTokenUsageValue(value)
}

export function formatWorkflowCostCell(usageCost: WorkflowNodeUsageCostSnapshot | undefined): string {
  if (usageCost?.priceKnown !== true || typeof usageCost.costCny !== "number") return "未定价"
  return formatSynapseCost(usageCost.costCny)
}

export function formatWorkflowTotalCost(total: WorkflowTokenUsageTotal): string {
  if (total.pricedRows === 0) return "未定价"
  const cost = formatSynapseCost(total.costCny)
  return total.unpricedRows > 0 ? `${cost} · 部分定价` : cost
}

function compareTokenRows(a: WorkflowTokenUsageRow, b: WorkflowTokenUsageRow): number {
  if (a.startedAt !== undefined && b.startedAt !== undefined && a.startedAt !== b.startedAt) {
    return a.startedAt - b.startedAt
  }
  if (a.startedAt !== undefined && b.startedAt === undefined) return -1
  if (a.startedAt === undefined && b.startedAt !== undefined) return 1
  return a.orderIndex - b.orderIndex
}

function roundCost(value: number): number {
  return Number(value.toFixed(6))
}
