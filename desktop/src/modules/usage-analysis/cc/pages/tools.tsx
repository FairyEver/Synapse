import { ToolsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcTools } from "../hooks"

export function CcToolsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ToolsReportView state={useCcTools(range, refreshKey)} />
}
