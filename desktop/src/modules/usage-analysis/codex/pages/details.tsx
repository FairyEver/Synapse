import { DetailsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexDetails } from "../hooks"

export function CodexDetailsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <DetailsReportView state={useCodexDetails(range, refreshKey)} refreshing={refreshing} />
}
