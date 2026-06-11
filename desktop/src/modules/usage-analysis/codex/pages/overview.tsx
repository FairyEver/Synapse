import { OverviewReportView } from "../../shared/components/report-views"
import type { UsageRangePreset, UsageTrendBucketGranularity } from "../../shared/types"
import { useCodexOverview } from "../hooks"

interface CodexOverviewPageProps {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly refreshing: boolean
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

export function CodexOverviewPage({ range, refreshKey, refreshing, trendBucket, onTrendBucketChange }: CodexOverviewPageProps) {
  return (
    <OverviewReportView
      state={useCodexOverview(range, refreshKey, trendBucket)}
      refreshing={refreshing}
      trendBucket={trendBucket}
      onTrendBucketChange={onTrendBucketChange}
    />
  )
}
