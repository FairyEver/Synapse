import { TimeReportView } from "../../shared/components/report-views"
import type { UsageRangePreset, UsageTrendBucketGranularity } from "../../shared/types"
import { useCodexTime } from "../hooks"

interface CodexTimePageProps {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly refreshing: boolean
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

export function CodexTimePage({ range, refreshKey, refreshing, trendBucket, onTrendBucketChange }: CodexTimePageProps) {
  return (
    <TimeReportView
      state={useCodexTime(range, refreshKey, trendBucket)}
      refreshing={refreshing}
      trendBucket={trendBucket}
      onTrendBucketChange={onTrendBucketChange}
    />
  )
}
