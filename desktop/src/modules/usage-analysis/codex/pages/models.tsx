import { ModelsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexModels } from "../hooks"

export function CodexModelsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ModelsReportView state={useCodexModels(range, refreshKey)} refreshing={refreshing} />
}
