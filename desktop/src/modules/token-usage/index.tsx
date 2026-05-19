import { useState, useEffect, useCallback, useRef } from "react"
import { useTokenUsageScan, useGraphResult, useModelReport, useDailyReport, useAgentReport, useHourlyReport, useHourlyProfile } from "./hooks/use-token-usage"
import type { ScanResult } from "./hooks/use-token-usage"
import { ScanButton } from "./components/scan-button"
import { OverviewView } from "./components/overview-view"
import { ModelsView } from "./components/models-view"
import { DailyView } from "./components/daily-view"
import { AgentsView } from "./components/agents-view"
import { StatsView } from "./components/stats-view"
import { HourlyView } from "./components/hourly-view"
import { DateRangeFilter, dateRangeToOptions } from "./components/date-range-filter"
import type { RangePreset } from "./components/date-range-filter"
import { GroupByPicker } from "./components/group-by-picker"
import type { GroupByMode } from "./components/group-by-picker"
import { ExportButton } from "./components/export-button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

type SubTab = "overview" | "models" | "daily" | "hourly" | "agents" | "stats"

export function TokenUsageModule() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("overview")
  const [range, setRange] = useState<RangePreset>("30d")
  const [groupBy, setGroupBy] = useState<GroupByMode>("clientModel")
  const { scan, scanning, error: scanError } = useTokenUsageScan()
  const { data: graphResult, loading: graphLoading, error: graphError, refresh: refreshGraph } = useGraphResult()
  const { data: models, loading: modelsLoading, error: modelsError, refresh: refreshModels } = useModelReport()
  const { data: dailyRows, loading: dailyLoading, error: dailyError, refresh: refreshDaily } = useDailyReport()
  const { data: agentRows, loading: agentsLoading, error: agentsError, refresh: refreshAgents } = useAgentReport()
  const { data: hourlyRows, loading: hourlyLoading, error: hourlyError, refresh: refreshHourly } = useHourlyReport()
  const { data: hourlyProfile, loading: hourlyProfileLoading, error: hourlyProfileError, refresh: refreshHourlyProfile } = useHourlyProfile()
  const [lastScanInfo, setLastScanInfo] = useState<Pick<ScanResult, "elapsedMs" | "newMessages"> | null>(null)
  const initialScanDone = useRef(false)
  const rangeRef = useRef(range)
  rangeRef.current = range

  const refreshAll = useCallback((options?: { since?: string; until?: string }) => {
    void refreshGraph(options)
    void refreshModels({ ...options, groupBy })
    void refreshDaily(options)
    void refreshAgents(options)
    void refreshHourly(options)
    void refreshHourlyProfile(options)
  }, [refreshGraph, refreshModels, refreshDaily, refreshAgents, refreshHourly, refreshHourlyProfile, groupBy])

  const handleScan = useCallback(async () => {
    const result = await scan()
    if (result) {
      setLastScanInfo({ elapsedMs: result.elapsedMs, newMessages: result.newMessages })
    }
    refreshAll(dateRangeToOptions(rangeRef.current))
  }, [scan, refreshAll])

  const handleRangeChange = useCallback((preset: RangePreset) => {
    setRange(preset)
    refreshAll(dateRangeToOptions(preset))
  }, [refreshAll])

  const handleGroupByChange = useCallback((mode: GroupByMode) => {
    setGroupBy(mode)
    void refreshModels({ ...dateRangeToOptions(range), groupBy: mode })
  }, [refreshModels, range])

  useEffect(() => {
    if (!initialScanDone.current) {
      initialScanDone.current = true
      void handleScan()
    }
  }, [])

  const loadErrors = [scanError, graphError, modelsError, dailyError, agentsError, hourlyError, hourlyProfileError].filter(Boolean)
  const isLoading = graphLoading || modelsLoading || dailyLoading || agentsLoading || hourlyLoading || hourlyProfileLoading

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b px-4 pt-3 pb-2">
        <Tabs value={activeSubTab} onValueChange={(v) => setActiveSubTab(v as SubTab)}>
          <TabsList>
            <TabsTrigger value="overview">概览</TabsTrigger>
            <TabsTrigger value="models">模型</TabsTrigger>
            <TabsTrigger value="daily">日报</TabsTrigger>
            <TabsTrigger value="hourly">时段</TabsTrigger>
            <TabsTrigger value="agents">智能体</TabsTrigger>
            <TabsTrigger value="stats">统计</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
      <div className="flex items-center gap-2 px-4 py-2">
        {activeSubTab === "models" && (
          <GroupByPicker value={groupBy} onChange={handleGroupByChange} />
        )}
        <div className="flex-1" />
        <DateRangeFilter value={range} onChange={handleRangeChange} />
        <ExportButton models={models} agents={agentRows} dailyRows={dailyRows} graphResult={graphResult} />
        <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} error={scanError} />
      </div>
      <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
        <div className="flex flex-col gap-3">
          {loadErrors.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{loadErrors[0]?.message ?? "读取失败"}</span>
                <Button size="sm" variant="outline" onClick={() => void handleScan()}>
                  重试
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
          {isLoading && !graphResult ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : null}
          {activeSubTab === "overview" && graphResult ? (
            <OverviewView graphResult={graphResult} hourlyRows={hourlyRows} />
          ) : null}
          {activeSubTab === "models" ? (
            <ModelsView models={models} />
          ) : null}
          {activeSubTab === "daily" ? (
            <DailyView rows={dailyRows as { date: string; turns: number; messages: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number }[]} />
          ) : null}
          {activeSubTab === "hourly" ? (
            <HourlyView rows={hourlyRows} profile={hourlyProfile} />
          ) : null}
          {activeSubTab === "agents" ? (
            <AgentsView agents={agentRows} />
          ) : null}
          {activeSubTab === "stats" && graphResult ? (
            <StatsView graphResult={graphResult} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
