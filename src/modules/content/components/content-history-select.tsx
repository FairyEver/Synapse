import type { SynapseContentHistoryEntry } from "@/types/content"
import { CircleAlert } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ContentHistorySelectProps = {
  history: SynapseContentHistoryEntry[]
  latestHistoryDirname: string
  selectedHistoryDirname: string
  onSelectedHistoryDirnameChange: (historyDirname: string) => void
}

function formatDateTime(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date)
}

function buildHistoryLabel(
  entry: SynapseContentHistoryEntry,
  latestHistoryDirname: string,
  oldestHistoryDirname: string,
): string {
  const tags: string[] = []

  if (entry.dirname === latestHistoryDirname) {
    tags.push("最新")
  }

  if (entry.dirname === oldestHistoryDirname) {
    tags.push("最旧")
  }

  if (entry.deleted) {
    tags.push("已删除")
  }

  const authorLabel = entry.modifiedByDisplayName || "未命名用户"
  const tagLabel = tags.length > 0 ? ` · ${tags.join(" / ")}` : ""

  return `${formatDateTime(entry.modifiedAt)} · ${authorLabel} #${entry.modifiedBy.slice(0, 8)}${tagLabel}`
}

function ContentHistorySelect({
  history,
  latestHistoryDirname,
  selectedHistoryDirname,
  onSelectedHistoryDirnameChange,
}: ContentHistorySelectProps) {
  const oldestHistoryDirname = history[history.length - 1]?.dirname ?? latestHistoryDirname
  const isHistorical = selectedHistoryDirname !== latestHistoryDirname
  const selectedEntry = history.find((entry) => entry.dirname === selectedHistoryDirname)
  const historicalMessage =
    isHistorical && selectedEntry
      ? `你在查看历史版本（${formatDateTime(selectedEntry.modifiedAt)}），这不是当前内容。`
      : null

  return (
    <div className="flex items-center gap-2">
      <Select value={selectedHistoryDirname} onValueChange={onSelectedHistoryDirnameChange}>
        <SelectTrigger aria-label="历史版本" className="min-w-0 flex-1 sm:max-w-80">
          <SelectValue placeholder="选择历史版本" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>历史版本</SelectLabel>
            {history.map((entry) => (
              <SelectItem key={entry.dirname} value={entry.dirname}>
                {buildHistoryLabel(entry, latestHistoryDirname, oldestHistoryDirname)}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {historicalMessage ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label="正在查看历史版本"
                className="shrink-0"
              >
                <CircleAlert />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{historicalMessage}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : null}
    </div>
  )
}

export { ContentHistorySelect }
