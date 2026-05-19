import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { UsageAnalysisShell } from "../shared/components/usage-analysis-shell"
import type { UsageRangePreset, UsageViewId } from "../shared/types"
import { CcDetailsPage } from "./pages/details"
import { CcModelsPage } from "./pages/models"
import { CcOverviewPage } from "./pages/overview"
import { CcProjectsPage } from "./pages/projects"
import { CcTimePage } from "./pages/time"
import { CcToolsPage } from "./pages/tools"

export function CcUsagePage() {
  const [view, setView] = useState<UsageViewId>("overview")
  const [range, setRange] = useState<UsageRangePreset>("30d")
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await requireSynapseBridge().usageAnalysis.cc.refresh()
      setRefreshKey((current) => current + 1)
    } catch {
      setRefreshKey((current) => current + 1)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <UsageAnalysisShell
      title="CC"
      view={view}
      range={range}
      refreshing={refreshing}
      onViewChange={setView}
      onRangeChange={setRange}
      onRefresh={() => {
        void refresh()
      }}
    >
      {view === "overview" ? <CcOverviewPage range={range} refreshKey={refreshKey} /> : null}
      {view === "time" ? <CcTimePage range={range} refreshKey={refreshKey} /> : null}
      {view === "models" ? <CcModelsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "projects" ? <CcProjectsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "tools" ? <CcToolsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "details" ? <CcDetailsPage range={range} refreshKey={refreshKey} /> : null}
    </UsageAnalysisShell>
  )
}
