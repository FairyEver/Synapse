import { differenceInCalendarDays, format } from "date-fns"

/**
 * 列表按天分组时，今天的行显示相对时间，更早的行只补访问时刻。
 * 搜索或筛选后跨天结果混在一起，改用「今天 N小时前 / N天前 / M月d日」。
 */
export function formatDriveHistoryVisitTime(value: string, input: { readonly filtered: boolean; readonly now?: Date }): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "-"
  const now = input.now ?? new Date()
  const days = differenceInCalendarDays(now, date)
  if (input.filtered) {
    if (days <= 0) return `今天 ${formatElapsed(now.getTime() - date.getTime())}`
    if (days < 7) return `${days}天前`
    return format(date, "M月d日")
  }
  if (days === 0) return formatElapsed(now.getTime() - date.getTime())
  return format(date, "HH:mm")
}

function formatElapsed(elapsed: number): string {
  if (elapsed < 60_000) return "刚刚"
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 60) return `${minutes}分钟前`
  return `${Math.floor(minutes / 60)}小时前`
}
