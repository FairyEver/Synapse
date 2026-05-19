import { requireSynapseBridge } from "@/lib/electron-bridge"
import { toUsageRangeInput } from "../shared/range"
import { useReportLoader } from "../shared/use-report-loader"
import type { UsageRangePreset } from "../shared/types"

export function useCodexOverview(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getOverview(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCodexTime(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getTime(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCodexModels(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getModels(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCodexProjects(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getProjects(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCodexTools(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getTools(toUsageRangeInput(range)),
    [range, refreshKey],
  )
}

export function useCodexDetails(range: UsageRangePreset, refreshKey: number) {
  return useReportLoader(
    () => requireSynapseBridge().usageAnalysis.codex.getDetails({ ...toUsageRangeInput(range), limit: 200 }),
    [range, refreshKey],
  )
}
