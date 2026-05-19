import type {
  UsageAnalysisDetailRow,
  UsageAnalysisModelRow,
  UsageAnalysisOverviewReport,
  UsageAnalysisProjectRow,
  UsageAnalysisRangePreset,
  UsageAnalysisTimeBucket,
  UsageAnalysisToolRow,
} from "@/types/bridge"

export type UsageRangePreset = UsageAnalysisRangePreset
export type UsageViewId = "overview" | "time" | "models" | "projects" | "tools"
export type UsageOverviewReport = UsageAnalysisOverviewReport
export type UsageTimeBucket = UsageAnalysisTimeBucket
export type UsageModelRow = UsageAnalysisModelRow
export type UsageProjectRow = UsageAnalysisProjectRow
export type UsageToolRow = UsageAnalysisToolRow
export type UsageDetailRow = UsageAnalysisDetailRow

export type ReportState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: Error | null
  readonly reload: () => Promise<void>
}
