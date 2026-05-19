import { ModelsReportView } from "../../shared/components/report-views"
import type { UsageRangePreset } from "../../shared/types"
import { useCcModels } from "../hooks"

export function CcModelsPage({ range, refreshKey }: { readonly range: UsageRangePreset; readonly refreshKey: number }) {
  return <ModelsReportView state={useCcModels(range, refreshKey)} />
}
