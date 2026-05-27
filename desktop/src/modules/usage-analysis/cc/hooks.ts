import { requireSynapseBridge } from "@/lib/electron-bridge"
import type { CcConversationListInput } from "@/types/usage-analysis-conversations"
import { toUsageRangeInput } from "../shared/range"
import { useReportLoader } from "../shared/use-report-loader"
import type { UsageReportRangePreset, UsageTrendBucketGranularity } from "../shared/types"

export function useCcOverview(range: UsageReportRangePreset, refreshKey: number, bucket?: UsageTrendBucketGranularity) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getOverview(toUsageRangeInput(range, bucket)),
    [range, refreshKey, bucket],
  )
}

export function useCcTime(range: UsageReportRangePreset, refreshKey: number, bucket?: UsageTrendBucketGranularity) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getTime(toUsageRangeInput(range, bucket)),
    [range, refreshKey, bucket],
  )
}

export function useCcModels(range: UsageReportRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getModels(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcProjects(range: UsageReportRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getProjects(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcTools(range: UsageReportRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getTools(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcDetails(range: UsageReportRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getDetails({ ...toUsageRangeInput(range), limit: 200 }),
    [range, refreshKey],
  )
}

export function useCcConversations(input: CcConversationListInput, refreshKey: number) {
  return useReportLoader(
    () => input.rawText
      ? requireSynapseBridge().usageAnalysis.cc.searchConversationText(input)
      : requireSynapseBridge().usageAnalysis.cc.listConversations(input),
    [
      input.preset,
      input.query,
      input.rawText,
      input.project,
      input.model,
      input.tool,
      input.eventType,
      input.limit,
      input.offset,
      input.cursor,
      refreshKey,
    ],
  )
}
