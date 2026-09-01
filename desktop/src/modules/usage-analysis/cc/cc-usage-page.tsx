import { useCallback, useState } from "react"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { startTrackedOperation } from "@/lib/ui-tracking"
import { useUsageAutoRefresh } from "../shared/auto-refresh"
import { CC_USAGE_VIEWS, UsageAnalysisShell } from "../shared/components/usage-analysis-shell"
import { TodayReportView } from "../shared/components/today-report-view"
import { getUsageRefreshWarning } from "../shared/refresh-result"
import type { UsageRangePreset, UsageTrendBucketGranularity, UsageViewId } from "../shared/types"
import type { UsageAnalysisRefreshInput } from "@/types/bridge"
import { useCcModels, useCcOverview, useCcTime } from "./hooks"
import { CcModelsPage } from "./pages/models"
import { CcOverviewPage } from "./pages/overview"
import { CcProjectsPage } from "./pages/projects"
import { CcRecordsPage } from "./pages/records"
import { CcTimePage } from "./pages/time"
import { CcToolsPage } from "./pages/tools"

export function CcUsagePage() {
  const { error: showError, warning: showWarning } = useAppNotifications()
  const [view, setView] = useState<UsageViewId>("today")
  const [range, setRange] = useState<UsageRangePreset>("30d")
  const [trendBucket, setTrendBucket] = useState<UsageTrendBucketGranularity>("day")
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = useCallback(async (input?: UsageAnalysisRefreshInput) => {
    const finishTracking = startTrackedOperation({ component: "usage-analysis", eventKey: "usage-analysis.cc.refresh" })
    setRefreshing(true)
    try {
      const result = input
        ? await requireSynapseBridge().usageAnalysis.cc.refresh(input)
        : await requireSynapseBridge().usageAnalysis.cc.refresh()
      const warning = getUsageRefreshWarning(result)
      if (warning) showWarning(warning)
      setRefreshKey((current) => current + 1)
      finishTracking("success")
    } catch {
      finishTracking("failure")
      showError("刷新失败")
    } finally {
      setRefreshing(false)
    }
  }, [showError, showWarning])
  const refreshToday = useCallback(() => refresh({ preset: "today" }), [refresh])

  useUsageAutoRefresh("cc", refreshToday)

  return (
    <UsageAnalysisShell
      view={view}
      views={CC_USAGE_VIEWS}
      range={range}
      refreshing={refreshing}
      onViewChange={setView}
      onRangeChange={setRange}
      onRefresh={() => {
        if (view === "today") {
          void refresh({ preset: "today" })
          return
        }
        void refresh()
      }}
    >
      {view === "today" ? <CcTodayPage refreshKey={refreshKey} refreshing={refreshing} /> : null}
      {view === "overview" ? <CcOverviewPage range={range} refreshKey={refreshKey} refreshing={refreshing} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "time" ? <CcTimePage range={range} refreshKey={refreshKey} refreshing={refreshing} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "models" ? <CcModelsPage range={range} refreshKey={refreshKey} refreshing={refreshing} /> : null}
      {view === "projects" ? <CcProjectsPage range={range} refreshKey={refreshKey} refreshing={refreshing} /> : null}
      {view === "tools" ? <CcToolsPage range={range} refreshKey={refreshKey} refreshing={refreshing} /> : null}
      {view === "records" ? <CcRecordsPage range={range} refreshKey={refreshKey} refreshing={refreshing} /> : null}
    </UsageAnalysisShell>
  )
}

function CcTodayPage({ refreshKey, refreshing }: { readonly refreshKey: number; readonly refreshing: boolean }) {
  return (
    <TodayReportView
      overviewState={useCcOverview("today", refreshKey)}
      timeState={useCcTime("today", refreshKey)}
      modelsState={useCcModels("today", refreshKey)}
      refreshing={refreshing}
    />
  )
}
