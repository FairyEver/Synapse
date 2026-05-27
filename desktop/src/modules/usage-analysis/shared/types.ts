import type {
  UsageAnalysisDetailRow,
  UsageAnalysisModelPriceRule,
  UsageAnalysisModelPriceRuleInput,
  UsageAnalysisModelRow,
  UsageAnalysisOverviewReport,
  UsageAnalysisProjectRow,
  UsageAnalysisRangePreset,
  UsageAnalysisTimeBucketGranularity,
  UsageAnalysisTimeBucket,
  UsageAnalysisToolRow,
} from "@/types/bridge"

export type UsageReportRangePreset = UsageAnalysisRangePreset
export type UsageRangePreset = Exclude<UsageAnalysisRangePreset, "today">
export type UsageTrendBucketGranularity = UsageAnalysisTimeBucketGranularity
export type UsageViewId = "today" | "overview" | "time" | "models" | "projects" | "tools" | "details" | "conversations"
export type UsageOverviewReport = UsageAnalysisOverviewReport
export type UsageTimeBucket = UsageAnalysisTimeBucket
export type UsageModelRow = UsageAnalysisModelRow
export type UsageProjectRow = UsageAnalysisProjectRow
export type UsageToolRow = UsageAnalysisToolRow
export type UsageDetailRow = UsageAnalysisDetailRow
export type UsageModelPriceRule = UsageAnalysisModelPriceRule
export type UsageModelPriceRuleInput = UsageAnalysisModelPriceRuleInput

export type ReportState<T> = {
  readonly data: T | null
  readonly loading: boolean
  readonly error: Error | null
  readonly reload: () => Promise<void>
}
