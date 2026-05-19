import { requireSynapseBridge } from "@/lib/electron-bridge"
import { toUsageRangeInput } from "../shared/range"
import { useReportLoader } from "../shared/use-report-loader"
import type { UsageRangePreset } from "../shared/types"

export function useCcOverview(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getOverview(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcTime(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getTime(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcModels(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getModels(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcProjects(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getProjects(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcTools(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getTools(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCcDetails(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.cc.getDetails({ ...toUsageRangeInput(range), limit: 200 }),
    [range, refreshKey],
  )
}
