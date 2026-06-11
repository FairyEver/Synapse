import { ModelsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcModels } from "../hooks"

export function CcModelsPage({ range, refreshKey, refreshing }: { readonly range: UsageRangePreset; readonly refreshKey: number; readonly refreshing: boolean }) {
  return <ModelsReportView state={useCcModels(range, refreshKey)} refreshing={refreshing} />
}
