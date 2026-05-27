export const CC_RECORD_PAGE_SIZE = 50

interface RecordLoadState {
  readonly shown: number
  readonly total: number
  readonly loading: boolean
}

interface RecordLoadGuardState extends RecordLoadState {
  readonly lastRequestedShown: number | null
}

export function formatRecordLoadStatus({ shown, total, loading }: RecordLoadState): string {
  if (total <= 0) return ""
  if (loading && shown > 0 && shown < total) {
    const nextStart = shown + 1
    const nextEnd = Math.min(shown + CC_RECORD_PAGE_SIZE, total)
    return `正在加载 ${nextStart}-${nextEnd} / ${total}`
  }
  if (shown >= total) return `已显示全部 ${total} 条`
  return `已显示 ${shown} / ${total}`
}

export function shouldRequestNextRecords({
  shown,
  total,
  loading,
  lastRequestedShown,
}: RecordLoadGuardState): boolean {
  return shown > 0 && shown < total && !loading && lastRequestedShown !== shown
}
