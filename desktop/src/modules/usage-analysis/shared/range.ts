import type { UsageRangePreset, UsageReportRangePreset } from "./types"

export const USAGE_RANGE_OPTIONS: { readonly value: UsageRangePreset; readonly label: string }[] = [
  { value: "7d", label: "7 天" },
  { value: "30d", label: "30 天" },
  { value: "90d", label: "90 天" },
  { value: "all", label: "全部" },
]

export function toUsageRangeInput(preset: UsageReportRangePreset): { preset: UsageReportRangePreset } {
  return { preset }
}
