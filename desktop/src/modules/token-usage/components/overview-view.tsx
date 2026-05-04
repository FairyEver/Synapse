import { StackedBarChart } from "./stacked-bar-chart"
import { formatTokens, formatCost, formatPercent } from "../lib/format"
import { getProviderColor } from "../lib/colors"
import type { GraphResult } from "../hooks/use-token-usage"

interface OverviewViewProps {
  graphResult: GraphResult
}

export function OverviewView({ graphResult }: OverviewViewProps) {
  const { summary, contributions } = graphResult

  const modelMap = new Map<string, { providerId: string; tokens: number; cost: number }>()
  for (const c of contributions) {
    for (const cl of c.clients) {
      const total = cl.tokens.input + cl.tokens.output + cl.tokens.cacheRead + cl.tokens.cacheWrite + cl.tokens.reasoning
      const existing = modelMap.get(cl.modelId) || { providerId: cl.providerId, tokens: 0, cost: 0 }
      existing.tokens += total
      existing.cost += cl.cost
      modelMap.set(cl.modelId, existing)
    }
  }
  const topModels = [...modelMap.entries()]
    .sort((a, b) => b[1].tokens - a[1].tokens)
    .slice(0, 10)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Tokens per Day</h3>
        <span className="text-sm text-muted-foreground">
          Total: {formatCost(summary.totalCost)}
        </span>
      </div>
      <StackedBarChart contributions={contributions} />
      <div>
        <h3 className="mb-2 text-sm font-medium">Top Models</h3>
        <div className="space-y-1">
          {topModels.map(([modelId, info], i) => (
            <div key={modelId} className="flex items-center gap-2 text-sm">
              <span className="w-5 text-right text-muted-foreground">{i + 1}</span>
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getProviderColor(info.providerId) }}
              />
              <span className="flex-1 truncate">{modelId}</span>
              <span className="text-muted-foreground">{formatPercent(info.tokens, summary.totalTokens)}</span>
              <span className="w-20 text-right">{formatTokens(info.tokens)}</span>
              <span className="w-16 text-right text-muted-foreground">{formatCost(info.cost)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
