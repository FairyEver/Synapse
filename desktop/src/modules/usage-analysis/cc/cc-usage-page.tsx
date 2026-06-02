import { useState } from "react"
import { useAppNotifications } from "@/app-shell/notifications"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { PricingRulesDialog } from "../shared/components/pricing-rules-dialog"
import { CC_USAGE_VIEWS, UsageAnalysisShell } from "../shared/components/usage-analysis-shell"
import { TodayReportView } from "../shared/components/today-report-view"
import { getUsageRefreshWarning } from "../shared/refresh-result"
import type { UsageRangePreset, UsageTrendBucketGranularity, UsageViewId } from "../shared/types"
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
  const [pricingRulesOpen, setPricingRulesOpen] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      const result = await requireSynapseBridge().usageAnalysis.cc.refresh()
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
      title="CC"
      view={view}
      views={CC_USAGE_VIEWS}
      range={range}
      refreshing={refreshing}
      onViewChange={setView}
      onRangeChange={setRange}
      onPricingRulesClick={() => setPricingRulesOpen(true)}
      onRefresh={() => {
        void refresh()
      }}
    >
      <PricingRulesDialog
        open={pricingRulesOpen}
        onOpenChange={setPricingRulesOpen}
        onSaved={() => setRefreshKey((current) => current + 1)}
      />
      {view === "today" ? <CcTodayPage refreshKey={refreshKey} /> : null}
      {view === "overview" ? <CcOverviewPage range={range} refreshKey={refreshKey} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "time" ? <CcTimePage range={range} refreshKey={refreshKey} trendBucket={trendBucket} onTrendBucketChange={setTrendBucket} /> : null}
      {view === "models" ? <CcModelsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "projects" ? <CcProjectsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "tools" ? <CcToolsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "records" ? <CcRecordsPage range={range} refreshKey={refreshKey} /> : null}
    </UsageAnalysisShell>
  )
}

function CcTodayPage({ refreshKey }: { readonly refreshKey: number }) {
  return (
    <TodayReportView
      overviewState={useCcOverview("today", refreshKey)}
      timeState={useCcTime("today", refreshKey)}
      modelsState={useCcModels("today", refreshKey)}
    />
  )
}
