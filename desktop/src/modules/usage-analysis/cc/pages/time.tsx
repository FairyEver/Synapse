import { TimeReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcTime } from "../hooks"

export function CcTimePage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <TimeReportView state={useCcTime(range, refreshKey)} />
}
