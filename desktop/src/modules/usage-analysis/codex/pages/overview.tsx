import { OverviewReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexOverview } from "../hooks"

export function CodexOverviewPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <OverviewReportView state={useCodexOverview(range, refreshKey)} />
}
