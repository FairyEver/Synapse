import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { SynapseLogEntry } from "@/types/log"
import { LOG_PAGE_SIZE, useLogFeed } from "@/modules/logs/hooks/use-log-feed"

const LOG_ROW_HEIGHT = 44
const LOG_LIST_HEIGHT = 420
const LOG_OVERSCAN = 10

function formatTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function getLevelClassName(entry: SynapseLogEntry | null): string {
  if (!entry) {
    return "text-muted-foreground"
  }

  if (entry.level === "error") {
    return "text-destructive"
  }

  if (entry.level === "warn") {
    return "text-foreground"
  }

  return "text-muted-foreground"
}

function LogsPanel() {
  const {
    ensureRangeLoaded,
    error,
    exportLogFile,
    getEntryAtIndex,
    isExporting,
    isLoading,
    selectedEntry,
    selectedEntryId,
    setSelectedEntryId,
    total,
  } = useLogFeed()
  const listRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(LOG_LIST_HEIGHT)
  const [exportMessage, setExportMessage] = useState<string | null>(null)

  const visibleStartIndex = Math.max(0, Math.floor(scrollTop / LOG_ROW_HEIGHT) - LOG_OVERSCAN)
  const visibleEndIndex = Math.min(
    Math.max(total - 1, 0),
    Math.ceil((scrollTop + viewportHeight) / LOG_ROW_HEIGHT) + LOG_OVERSCAN,
  )

  useEffect(() => {
    const listElement = listRef.current

    if (!listElement) {
      return
    }

    const syncViewportHeight = () => {
      setViewportHeight(listElement.clientHeight || LOG_LIST_HEIGHT)
    }

    syncViewportHeight()
    window.addEventListener("resize", syncViewportHeight)

    return () => {
      window.removeEventListener("resize", syncViewportHeight)
    }
  }, [])

  useEffect(() => {
    if (total === 0) {
      return
    }

    ensureRangeLoaded(visibleStartIndex, visibleEndIndex)
  }, [ensureRangeLoaded, total, visibleEndIndex, visibleStartIndex])

  useEffect(() => {
    const listElement = listRef.current

    if (!listElement || !pinnedToBottomRef.current) {
      return
    }

    listElement.scrollTop = Math.max(0, total * LOG_ROW_HEIGHT - listElement.clientHeight)
  }, [total])

  const visibleRows = useMemo(() => {
    const rows: Array<{ entry: SynapseLogEntry | null; index: number }> = []

    for (let entryIndex = visibleStartIndex; entryIndex <= visibleEndIndex; entryIndex += 1) {
      rows.push({
        entry: getEntryAtIndex(entryIndex),
        index: entryIndex,
      })
    }

    return rows
  }, [getEntryAtIndex, visibleEndIndex, visibleStartIndex])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <CardTitle>日志</CardTitle>
            <CardDescription>查看当前运行中的主进程和渲染层日志。</CardDescription>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void exportLogFile().then((result) => {
                setExportMessage(`已导出 ${result.entryCount} 条日志到 ${result.filePath}`)
              }).catch(() => {})
            }}
            disabled={isExporting}
          >
            {isExporting ? "导出中..." : "下载日志"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
          <p>共 {total} 条</p>
          <p>按需加载，每页 {LOG_PAGE_SIZE} 条</p>
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {exportMessage ? <p className="text-sm text-muted-foreground">{exportMessage}</p> : null}

        <div className="overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[120px_96px_72px_minmax(0,1fr)] gap-3 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
            <span>时间</span>
            <span>来源</span>
            <span>级别</span>
            <span>消息</span>
          </div>

          <div
            ref={listRef}
            className="overflow-y-auto"
            style={{ height: `${LOG_LIST_HEIGHT}px` }}
            onScroll={(event) => {
              const nextScrollTop = event.currentTarget.scrollTop

              setScrollTop(nextScrollTop)
              pinnedToBottomRef.current =
                nextScrollTop + event.currentTarget.clientHeight
                >= event.currentTarget.scrollHeight - LOG_ROW_HEIGHT
            }}
          >
            {total === 0 && isLoading ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                正在加载日志...
              </div>
            ) : total === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
                还没有日志。
              </div>
            ) : (
              <div
                className="relative"
                style={{ height: `${Math.max(total * LOG_ROW_HEIGHT, LOG_LIST_HEIGHT)}px` }}
              >
                {visibleRows.map(({ entry, index }) => (
                  <button
                    key={entry?.id ?? `placeholder-${index}`}
                    type="button"
                    className={`absolute left-0 grid h-11 w-full grid-cols-[120px_96px_72px_minmax(0,1fr)] gap-3 border-b px-3 text-left text-xs ${
                      selectedEntryId === entry?.id ? "bg-muted/60" : "bg-background"
                    }`}
                    style={{ top: `${index * LOG_ROW_HEIGHT}px` }}
                    onClick={() => {
                      if (entry) {
                        setSelectedEntryId(entry.id)
                      }
                    }}
                  >
                    <span className="self-center truncate text-muted-foreground">
                      {entry ? formatTimestamp(entry.createdAt) : "加载中..."}
                    </span>
                    <span className="self-center truncate text-muted-foreground">
                      {entry ? `${entry.source}:${entry.category}` : ""}
                    </span>
                    <span className={`self-center truncate font-medium ${getLevelClassName(entry)}`}>
                      {entry ? entry.level.toUpperCase() : ""}
                    </span>
                    <span className={`self-center truncate ${getLevelClassName(entry)}`}>
                      {entry?.message ?? ""}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <Separator />

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">详情</p>
            {selectedEntry ? (
              <p className="text-xs text-muted-foreground">
                {selectedEntry.source}:{selectedEntry.category}
              </p>
            ) : null}
          </div>

          {selectedEntry ? (
            <div className="flex flex-col gap-3 rounded-lg border p-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{selectedEntry.createdAt}</span>
                <span>{selectedEntry.level.toUpperCase()}</span>
              </div>
              <p className="text-sm font-medium">{selectedEntry.message}</p>
              <pre className="overflow-x-auto rounded-md bg-muted/50 p-3 text-xs whitespace-pre-wrap break-words text-foreground">
                {selectedEntry.details ?? "无附加详情。"}
              </pre>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {isLoading ? "正在加载日志..." : "选择一条日志后，这里会显示完整内容。"}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export { LogsPanel }
