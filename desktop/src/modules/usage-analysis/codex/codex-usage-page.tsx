import { useState } from "react"
import { requireSynapseBridge } from "@/lib/electron-bridge"
import { UsageAnalysisShell } from "../shared/components/usage-analysis-shell"
import type { UsageRangePreset, UsageViewId } from "../shared/types"
import { CodexDetailsPage } from "./pages/details"
import { CodexModelsPage } from "./pages/models"
import { CodexOverviewPage } from "./pages/overview"
import { CodexProjectsPage } from "./pages/projects"
import { CodexTimePage } from "./pages/time"
import { CodexToolsPage } from "./pages/tools"

export function CodexUsagePage() {
  const [view, setView] = useState<UsageViewId>("overview")
  const [range, setRange] = useState<UsageRangePreset>("30d")
  const [refreshKey, setRefreshKey] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await requireSynapseBridge().usageAnalysis.codex.refresh()
      setRefreshKey((current) => current + 1)
    } catch {
      setRefreshKey((current) => current + 1)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <UsageAnalysisShell
      title="Codex"
      view={view}
      range={range}
      refreshing={refreshing}
      onViewChange={setView}
      onRangeChange={setRange}
      onRefresh={() => {
        void refresh()
      }}
    >
      {view === "overview" ? <CodexOverviewPage range={range} refreshKey={refreshKey} /> : null}
      {view === "time" ? <CodexTimePage range={range} refreshKey={refreshKey} /> : null}
      {view === "models" ? <CodexModelsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "projects" ? <CodexProjectsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "tools" ? <CodexToolsPage range={range} refreshKey={refreshKey} /> : null}
      {view === "details" ? <CodexDetailsPage range={range} refreshKey={refreshKey} /> : null}
    </UsageAnalysisShell>
  )
}
