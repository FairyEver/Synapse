import { formatDateTime } from "@/lib/date-time"

type HistoryLabelEntry = {
  dirname: string
  modifiedAt: string
  modifiedByDisplayName: string
  deleted: boolean
}

function buildHistoryLabel(
  entry: HistoryLabelEntry,
  latestDirname: string,
  oldestDirname: string,
  totalCount: number,
): string {
  const tags: string[] = []

  if (totalCount > 1) {
    if (entry.dirname === latestDirname) {
      tags.push("最新")
    }

    if (entry.dirname === oldestDirname) {
      tags.push("最旧")
    }
  }

  if (entry.deleted) {
    tags.push("已删除")
  }

  const authorLabel = entry.modifiedByDisplayName || "未命名用户"
  const tagLabel = tags.length > 0 ? ` · ${tags.join(" / ")}` : ""

  return `${formatDateTime(entry.modifiedAt)} · ${authorLabel}${tagLabel}`
}

export { buildHistoryLabel }
export type { HistoryLabelEntry }
