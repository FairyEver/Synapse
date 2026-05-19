import { TimeReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexTime } from "../hooks"

export function CodexTimePage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <TimeReportView state={useCodexTime(range, refreshKey)} />
}
