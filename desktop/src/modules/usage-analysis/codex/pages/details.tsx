import { DetailsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexDetails } from "../hooks"

export function CodexDetailsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <DetailsReportView state={useCodexDetails(range, refreshKey)} />
}
