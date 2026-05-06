import { useState, useEffect, useCallback, useMemo, useRef } from "react"
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
import { SourcePicker } from "./components/source-picker"
import { GroupByPicker } from "./components/group-by-picker"
import type { GroupByMode } from "./components/group-by-picker"
import { ExportButton } from "./components/export-button"
import { CursorConnectBadge } from "./components/cursor-connect-badge"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"

type SubTab = "overview" | "models" | "daily" | "hourly" | "agents" | "stats"

export function TokenUsageModule() {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>("overview")
  const [range, setRange] = useState<RangePreset>("30d")
  const [groupBy, setGroupBy] = useState<GroupByMode>("clientModel")
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const { scan, scanning, error: scanError } = useTokenUsageScan()
  const { data: graphResult, refresh: refreshGraph } = useGraphResult()
  const { data: models, refresh: refreshModels } = useModelReport()
  const { data: dailyRows, refresh: refreshDaily } = useDailyReport()
  const { data: agentRows, refresh: refreshAgents } = useAgentReport()
  const { data: hourlyRows, refresh: refreshHourly } = useHourlyReport()
  const { data: hourlyProfile, refresh: refreshHourlyProfile } = useHourlyProfile()
  const [lastScanInfo, setLastScanInfo] = useState<Pick<ScanResult, "elapsedMs" | "newMessages"> | null>(null)
  const initialScanDone = useRef(false)

  const allClients = useMemo(() => graphResult?.summary.clients ?? [], [graphResult])

  useEffect(() => {
    if (allClients.length > 0 && selectedSources.size === 0) {
      setSelectedSources(new Set(allClients))
    }
  }, [allClients, selectedSources.size])

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
    refreshAll(dateRangeToOptions(range))
  }, [scan, refreshAll, range])

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

  const sourceFilter = useCallback((client: string) => selectedSources.has(client), [selectedSources])
  const isFiltering = selectedSources.size > 0 && selectedSources.size < allClients.length

  const filteredModels = useMemo(() =>
    isFiltering ? models.filter((m) => sourceFilter(m.client)) : models,
  [models, isFiltering, sourceFilter])

  const filteredHourlyRows = useMemo(() =>
    isFiltering ? hourlyRows.filter((r) => sourceFilter(r.client)) : hourlyRows,
  [hourlyRows, isFiltering, sourceFilter])

  const filteredAgentRows = useMemo(() =>
    isFiltering ? agentRows.filter((a) => sourceFilter(a.client)) : agentRows,
  [agentRows, isFiltering, sourceFilter])

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
        <CursorConnectBadge onConnected={handleScan} />
        <div className="flex-1" />
        <SourcePicker clients={allClients} selected={selectedSources} onChange={setSelectedSources} />
        <DateRangeFilter value={range} onChange={handleRangeChange} />
        <ExportButton models={filteredModels} agents={filteredAgentRows} dailyRows={dailyRows} graphResult={graphResult} />
        <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} error={scanError} />
      </div>
      <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
        {activeSubTab === "overview" && graphResult ? (
          <OverviewView graphResult={graphResult} hourlyRows={filteredHourlyRows} />
        ) : null}
        {activeSubTab === "models" ? (
          <ModelsView models={filteredModels} />
        ) : null}
        {activeSubTab === "daily" ? (
          <DailyView rows={dailyRows as { date: string; turns: number; messages: number; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number }[]} />
        ) : null}
        {activeSubTab === "hourly" ? (
          <HourlyView rows={filteredHourlyRows} profile={hourlyProfile} />
        ) : null}
        {activeSubTab === "agents" ? (
          <AgentsView agents={filteredAgentRows} />
        ) : null}
        {activeSubTab === "stats" && graphResult ? (
          <StatsView graphResult={graphResult} />
        ) : null}
      </ScrollArea>
    </div>
  )
}
