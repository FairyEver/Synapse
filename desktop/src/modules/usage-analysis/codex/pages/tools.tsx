import { ToolsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexTools } from "../hooks"

export function CodexToolsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ToolsReportView state={useCodexTools(range, refreshKey)} refreshing={refreshing} />
}
