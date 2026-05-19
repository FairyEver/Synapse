import { useCallback, useState } from "react"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import type { GraphResult, ModelRow, AgentRow } from "../hooks/use-token-usage"

interface ExportButtonProps {
  models: ModelRow[]
  agents: AgentRow[]
  dailyRows: Record<string, unknown>[]
  graphResult: GraphResult | null
  isFiltering: boolean
}

export function ExportButton({ models, agents, dailyRows, graphResult, isFiltering }: ExportButtonProps) {
  const [exported, setExported] = useState(false)

  const handleExport = useCallback(() => {
    const totalTokens = models.reduce((sum, m) => sum + m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning, 0)
    const totalCost = models.reduce((sum, m) => sum + m.cost, 0)

    const data = {
      models: models.map((m) => ({
        model: m.model, provider: m.provider, client: m.client,
        tokens: { input: m.input, output: m.output, cacheRead: m.cacheRead, cacheWrite: m.cacheWrite, reasoning: m.reasoning, total: m.input + m.output + m.cacheRead + m.cacheWrite + m.reasoning },
        cost: m.cost, messageCount: m.messageCount,
      })),
      agents: agents.map((a) => ({
        agent: a.client, clients: a.providers,
        tokens: { input: a.input, output: a.output, cacheRead: a.cacheRead, cacheWrite: a.cacheWrite, reasoning: a.reasoning, total: a.input + a.output + a.cacheRead + a.cacheWrite + a.reasoning },
        cost: a.cost, messageCount: a.messageCount,
      })),
      daily: isFiltering ? null : dailyRows,
      totals: isFiltering
        ? { tokens: totalTokens, cost: totalCost }
        : graphResult
          ? { tokens: graphResult.summary.totalTokens, cost: graphResult.summary.totalCost }
          : null,
    }

    const json = JSON.stringify(data, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)
    a.href = url
    a.download = `tokscale-export-${ts}.json`
    a.click()
    URL.revokeObjectURL(url)
    setExported(true)
    setTimeout(() => setExported(false), 2000)
  }, [models, agents, dailyRows, graphResult, isFiltering])

  return (
    <Button variant="outline" size="sm" className="gap-1.5" onClick={handleExport}>
      <Download className="h-3.5 w-3.5" />
      {exported ? "已导出" : "导出"}
    </Button>
  )
}
