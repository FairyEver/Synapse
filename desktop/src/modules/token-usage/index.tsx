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
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const userHasFiltered = useRef(false)
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

  const allClients = useMemo(() => graphResult?.summary.clients ?? [], [graphResult])

  useEffect(() => {
    if (allClients.length > 0 && !userHasFiltered.current) {
      setSelectedSources(new Set(allClients))
    }
  }, [allClients])

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

  const sourceFilter = useCallback((client: string) => selectedSources.has(client), [selectedSources])
  const isFiltering = selectedSources.size > 0 && selectedSources.size < allClients.length
  const loadErrors = [scanError, graphError, modelsError, dailyError, agentsError, hourlyError, hourlyProfileError].filter(Boolean)
  const isLoading = graphLoading || modelsLoading || dailyLoading || agentsLoading || hourlyLoading || hourlyProfileLoading

  const filteredModels = useMemo(() =>
    isFiltering ? models.filter((m) => sourceFilter(m.client)) : models,
  [models, isFiltering, sourceFilter])

  const filteredHourlyRows = useMemo(() =>
    isFiltering ? hourlyRows.filter((r) => sourceFilter(r.client)) : hourlyRows,
  [hourlyRows, isFiltering, sourceFilter])

  const filteredAgentRows = useMemo(() =>
    isFiltering ? agentRows.filter((a) => sourceFilter(a.client)) : agentRows,
  [agentRows, isFiltering, sourceFilter])

  const filteredGraphResult = useMemo(() => {
    if (!graphResult || !isFiltering) return graphResult
    const filteredContributions = graphResult.contributions.map((day) => {
      const filteredClients = day.clients.filter((c) => selectedSources.has(c.client))
      const totals = filteredClients.reduce(
        (acc, c) => {
          acc.tokens += c.tokens.input + c.tokens.output + c.tokens.cacheRead + c.tokens.cacheWrite + c.tokens.reasoning
          acc.cost += c.cost
          acc.messages += c.messages
          return acc
        },
        { tokens: 0, cost: 0, messages: 0 },
      )
      const intensity: 0 | 1 | 2 | 3 | 4 =
        totals.tokens === 0 ? 0
        : totals.tokens <= 100 ? 1
        : totals.tokens <= 1000 ? 2
        : totals.tokens <= 10000 ? 3
        : 4
      return {
        ...day,
        clients: filteredClients,
        totals: { ...day.totals, ...totals },
        intensity,
        tokenBreakdown: filteredClients.reduce(
          (acc, c) => {
            acc.input += c.tokens.input; acc.output += c.tokens.output
            acc.cacheRead += c.tokens.cacheRead; acc.cacheWrite += c.tokens.cacheWrite
            acc.reasoning += c.tokens.reasoning
            return acc
          },
          { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
        ),
      }
    })
    const summary = {
      totalTokens: filteredContributions.reduce((s, d) => s + d.totals.tokens, 0),
      totalCost: filteredContributions.reduce((s, d) => s + d.totals.cost, 0),
      totalDays: filteredContributions.length,
      activeDays: filteredContributions.filter((d) => d.totals.tokens > 0).length,
      averagePerDay: filteredContributions.length > 0
        ? filteredContributions.reduce((s, d) => s + d.totals.tokens, 0) / filteredContributions.length
        : 0,
      maxCostInSingleDay: Math.max(...filteredContributions.map((d) => d.totals.cost), 0),
      clients: [...selectedSources],
      models: [...new Set(filteredContributions.flatMap((d) => d.clients.map((c) => c.modelId)))],
    }
    return { ...graphResult, summary, contributions: filteredContributions }
  }, [graphResult, isFiltering, selectedSources])

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
        <SourcePicker clients={allClients} selected={selectedSources} onChange={(next) => {
          const isSelectAll = allClients.length > 0 && allClients.every((c) => next.has(c))
          userHasFiltered.current = !isSelectAll
          setSelectedSources(next)
        }} />
        <DateRangeFilter value={range} onChange={handleRangeChange} />
        <ExportButton models={filteredModels} agents={filteredAgentRows} dailyRows={dailyRows} graphResult={filteredGraphResult} isFiltering={isFiltering} />
        <ScanButton scanning={scanning} onScan={handleScan} lastScanInfo={lastScanInfo} error={scanError} />
      </div>
      <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
        <div className="flex flex-col gap-3">
          {loadErrors.length > 0 ? (
            <Alert variant="destructive">
              <AlertDescription className="flex items-center justify-between gap-3">
                <span>{loadErrors[0]?.message ?? "读取失败"}</span>
                <Button size="sm" variant="outline" onClick={() => refreshAll(dateRangeToOptions(range))}>
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
          {activeSubTab === "overview" && filteredGraphResult ? (
            <OverviewView graphResult={filteredGraphResult} hourlyRows={filteredHourlyRows} />
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
          {activeSubTab === "stats" && filteredGraphResult ? (
            <StatsView graphResult={filteredGraphResult} />
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
