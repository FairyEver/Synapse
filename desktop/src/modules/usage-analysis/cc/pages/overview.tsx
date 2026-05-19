import { OverviewReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcOverview } from "../hooks"

export function CcOverviewPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <OverviewReportView state={useCcOverview(range, refreshKey)} />
}
