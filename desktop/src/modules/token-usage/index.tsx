import { useState, useEffect, useCallback } from "react"
import { useTokenUsageScan, useGraphResult, useModelReport, useDailyReport, useAgentReport } from "./hooks/use-token-usage"
import type { ScanResult } from "./hooks/use-token-usage"
import { ScanButton } from "./components/scan-button"
import { OverviewView } from "./components/overview-view"
import { ModelsView } from "./components/models-view"
import { DailyView } from "./components/daily-view"
import { AgentsView } from "./components/agents-view"
import { StatsView } from "./components/stats-view"
import { DateRangeFilter, dateRangeToOptions } from "./components/date-range-filter"
import type { RangePreset } from "./components/date-range-filter"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

type SubTab = "overview" | "models" | "daily" | "agents" | "stats"

export function TokenUsageModule() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("overview")
  const [range, setRange] = useState<RangePreset>("all")
  const { scan, scanning, error: scanError } = useTokenUsageScan()
  const { data: graphResult, refresh: refreshGraph } = useGraphResult()
  const { data: models, refresh: refreshModels } = useModelReport()
  const { data: dailyRows, refresh: refreshDaily } = useDailyReport()
  const { data: agentRows, refresh: refreshAgents } = useAgentReport()
  const [lastScanInfo, setLastScanInfo] = useState<Pick<ScanResult, "elapsedMs" | "newMessages"> | null>(null)
  const [hasScanned, setHasScanned] = useState(false)

  const refreshAll = useCallback((options?: { since?: string; until?: string }) => {
    void refreshGraph(options)
    void refreshModels(options)
    void refreshDaily(options)
    void refreshAgents(options)
  }, [refreshGraph, refreshModels, refreshDaily, refreshAgents])

  const handleScan = useCallback(async () => {
    const result = await scan()
    if (result) {
      setLastScanInfo({ elapsedMs: result.elapsedMs, newMessages: result.newMessages })
      refreshAll(dateRangeToOptions(range))
    }
  }, [scan, refreshAll, range])

  const handleRangeChange = useCallback((preset: RangePreset) => {
    setRange(preset)
    refreshAll(dateRangeToOptions(preset))
  }, [refreshAll])

  useEffect(() => {
    if (!hasScanned) {
      setHasScanned(true)
      void handleScan()
    }
  }, [hasScanned, handleScan])

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as SubTab)}>
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="models">Models</TabsTrigger>
            <TabsTrigger value="daily">Daily</TabsTrigger>
            <TabsTrigger value="agents">Agents</TabsTrigger>
            <TabsTrigger value="stats">Stats</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-2">
          <DateRangeFilter value={range} onChange={handleRangeChange} />
          <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} error={scanError} />
        </div>
      </div>
      <ScrollArea className="flex-1">
        {activeSubTab === "overview" && graphResult ? (
          <OverviewView graphResult={graphResult} />
        ) : null}
        {activeSubTab === "models" ? (
          <ModelsView models={models} />
        ) : null}
        {activeSubTab === "daily" ? (
          <DailyView rows={dailyRows as { date: string; turns: number; messages: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number }[]} />
        ) : null}
        {activeSubTab === "agents" ? (
          <AgentsView agents={agentRows} />
        ) : null}
        {activeSubTab === "stats" && graphResult ? (
          <StatsView graphResult={graphResult} />
        ) : null}
      </ScrollArea>
    </div>
  )
}
