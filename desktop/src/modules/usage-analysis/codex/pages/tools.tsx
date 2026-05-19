import { ToolsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexTools } from "../hooks"

export function CodexToolsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ToolsReportView state={useCodexTools(range, refreshKey)} />
}
