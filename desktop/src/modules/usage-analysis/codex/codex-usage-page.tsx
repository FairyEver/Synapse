import { useState } from "react"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { CODEX_USAGE_VIEWS, UsageAnalysisShell } from "../shared/components/usage-analysis-shell"
import { TodayReportView } from "../shared/components/today-report-view"
import { getUsageRefreshWarning } from "../shared/refresh-result"
import type { UsageRangePreset, UsageTrendBucketGranularity, UsageViewId } from "../shared/types"
import { useCodexModels, useCodexOverview, useCodexTime } from "./hooks"
import { CodexDetailsPage } from "./pages/details"
import { CodexModelsPage } from "./pages/models"
import { CodexOverviewPage } from "./pages/overview"
import { CodexProjectsPage } from "./pages/projects"
import { CodexTimePage } from "./pages/time"
import { CodexToolsPage } from "./pages/tools"

export function CodexUsagePage() {
  const { error: showError, warning: showWarning } = useAppNotifications()
  const [view, setView] = useState<UsageViewId>("today")
  const [range, setRange] = useState<UsageRangePreset>("30d")
  const [trendBucket, setTrendBucket] = useState<UsageTrendBucketGranularity>("day")
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await requireSynapseBridge().usageAnalysis.codex.refresh()
      const warning = getUsageRefreshWarning(result)
      if (warning) showWarning(warning)
      setRefreshKey((current) => current + 1)
    } catch {
      showError("刷新失败")
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <UsageAnalysisShell
      title="Codex"
      view={view}
      views={CODEX_USAGE_VIEWS}
      range={range}
      refreshing={refreshing}
      onViewChange={setView}
      onRangeChange={setRange}
      onRefresh={() => {
        void refresh()
      }}
    >
      {view === "today" ? <CodexTodayPage refreshKey={refreshKey} /> : null}
      {view === "overview" ? <CodexOverviewPage range={range} refreshKey={refreshKey} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "time" ? <CodexTimePage range={range} refreshKey={refreshKey} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "models" ? <CodexModelsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "projects" ? <CodexProjectsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "tools" ? <CodexToolsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "details" ? <CodexDetailsPage range={range} refreshKey={refreshKey} /> : null}
    </UsageAnalysisShell>
  )
}

function CodexTodayPage({ refreshKey }: { readonly refreshKey: number }) {
  return (
    <TodayReportView
      overviewState={useCodexOverview("today", refreshKey)}
      timeState={useCodexTime("today", refreshKey)}
      modelsState={useCodexModels("today", refreshKey)}
    />
  )
}
