import { TimeReportView } from "../../shared/components/report-views"
import type { UsageRangePreset, UsageTrendBucketGranularity } from "../../shared/types"
import { useCodexTime } from "../hooks"

interface CodexTimePageProps {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

export function CodexTimePage({ range, refreshKey, trendBucket, onTrendBucketChange }: CodexTimePageProps) {
  return (
    <TimeReportView
      state={useCodexTime(range, refreshKey, trendBucket)}
      trendBucket={trendBucket}
      onTrendBucketChange={onTrendBucketChange}
    />
  )
}
