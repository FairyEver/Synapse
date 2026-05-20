import { TimeReportView } from "../../shared/components/report-views"
import type { UsageRangePreset, UsageTrendBucketGranularity } from "../../shared/types"
import { useCcTime } from "../hooks"

interface CcTimePageProps {
  readonly range: UsageRangePreset
  readonly refreshKey: number
  readonly trendBucket: UsageTrendBucketGranularity
  readonly onTrendBucketChange: (bucket: UsageTrendBucketGranularity) => void
}

export function CcTimePage({ range, refreshKey, trendBucket, onTrendBucketChange }: CcTimePageProps) {
  return (
    <TimeReportView
      state={useCcTime(range, refreshKey, trendBucket)}
      trendBucket={trendBucket}
      onTrendBucketChange={onTrendBucketChange}
    />
  )
}
