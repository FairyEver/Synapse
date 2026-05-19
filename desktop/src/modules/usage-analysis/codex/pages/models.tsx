import { ModelsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCodexModels } from "../hooks"

export function CodexModelsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ModelsReportView state={useCodexModels(range, refreshKey)} />
}
