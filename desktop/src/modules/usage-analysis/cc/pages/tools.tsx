import { ToolsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcTools } from "../hooks"

export function CcToolsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ToolsReportView state={useCcTools(range, refreshKey)} refreshing={refreshing} />
}
