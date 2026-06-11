import { OverviewReportView } from "../../shared/components/report-views"
import type { UsageRangePreset, UsageTrendBucketGranularity } from "../../shared/types"
import { useCcOverview } from "../hooks"

interface CcOverviewPageProps {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly refreshing: boolean
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

export function CcOverviewPage({ range, refreshKey, refreshing, trendBucket, onTrendBucketChange }: CcOverviewPageProps) {
  return (
    <OverviewReportView
      state={useCcOverview(range, refreshKey, trendBucket)}
      refreshing={refreshing}
      trendBucket={trendBucket}
      onTrendBucketChange={onTrendBucketChange}
    />
  )
}
