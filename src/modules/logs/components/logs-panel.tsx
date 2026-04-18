import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { InlineNotice } from "@/components/inline-notice"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { SynapseLogEntry } from "@/types/log"
import { useLogFeed } from "@/modules/logs/hooks/use-log-feed"

const LOG_ROW_HEIGHT = 24
const LOG_LIST_FALLBACK_HEIGHT = 520
const LOG_OVERSCAN = 12
const LOG_ROW_HOVER_TEXT_CLASS = "group-hover:text-accent-foreground"

function formatTimestamp(value: string): string {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).format(date)
}

function getLevelClassName(entry: SynapseLogEntry | null): string {
  if (!entry) {
    return cn("text-muted-foreground", LOG_ROW_HOVER_TEXT_CLASS)
  }

  if (entry.level === "error") {
    return cn("text-destructive", LOG_ROW_HOVER_TEXT_CLASS)
  }

  if (entry.level === "warn") {
    return cn("text-foreground", LOG_ROW_HOVER_TEXT_CLASS)
  }

  return cn("text-muted-foreground", LOG_ROW_HOVER_TEXT_CLASS)
}

function normalizeLogText(value: string | null): string {
  return value?.replace(/\s+/g, " ").trim() ?? ""
}

function getLevelLabel(entry: SynapseLogEntry | null): string {
  return entry ? entry.level.toUpperCase().padEnd(5, " ") : ""
}

function LogsPanel() {
  const {
    clearExportError,
    ensureRangeLoaded,
    error,
    exportError,
    exportLogFile,
    getEntryAtIndex,
    isExporting,
    isLoading,
    total,
  } = useLogFeed()
  const listRef = useRef<HTMLDivElement | null>(null)
  const pinnedToBottomRef = useRef(true)
  const [scrollTop, setScrollTop] = useState(0)
  const [contentWidth, setContentWidth] = useState(0)
  const [exportNotice, setExportNotice] = useState<string | null>(null)
  const [viewportHeight, setViewportHeight] = useState(LOG_LIST_FALLBACK_HEIGHT)
  const [viewportWidth, setViewportWidth] = useState(0)

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

    const syncViewportSize = () => {
      const nextViewportHeight = listElement.clientHeight || LOG_LIST_FALLBACK_HEIGHT
      const nextViewportWidth = listElement.clientWidth

      setViewportHeight((currentHeight) => (
        currentHeight === nextViewportHeight ? currentHeight : nextViewportHeight
      ))
      setViewportWidth((currentWidth) => (
        currentWidth === nextViewportWidth ? currentWidth : nextViewportWidth
      ))
    }

    syncViewportSize()

    const resizeObserver = new ResizeObserver(() => {
      syncViewportSize()
    })
    resizeObserver.observe(listElement)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  useEffect(() => {
    if (total === 0) {
      setContentWidth(0)
    }
  }, [total])

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
  }, [total, viewportHeight])

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

  const measureRowContent = useCallback((node: HTMLDivElement | null) => {
    if (!node) {
      return
    }

    const nextWidth = Math.ceil(node.getBoundingClientRect().width)

    setContentWidth((currentWidth) => (
      currentWidth >= nextWidth ? currentWidth : nextWidth
    ))
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border bg-background">
      {exportError ? (
        <div className="border-b px-3 py-3">
          <InlineNotice
            message={exportError}
            tone="destructive"
            onDismiss={clearExportError}
          />
        </div>
      ) : null}

      {exportNotice ? (
        <div className="border-b px-3 py-3">
          <InlineNotice
            message={exportNotice}
            onDismiss={() => setExportNotice(null)}
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-4 border-b bg-muted/20 px-3 py-2">
        <p className="font-mono text-xs text-muted-foreground">共 {total} 条</p>
        <Button
          size="sm"
          disabled={isExporting}
          onClick={async () => {
            const result = await exportLogFile()

            if (!result) {
              setExportNotice(null)
              return
            }

            setExportNotice(`已保存到 ${result.filePath}`)
          }}
        >
          {isExporting ? "导出中..." : "下载日志"}
        </Button>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-auto bg-background font-mono text-xs leading-6"
        onScroll={(event) => {
          const nextScrollTop = event.currentTarget.scrollTop

          setScrollTop(nextScrollTop)
          pinnedToBottomRef.current =
            nextScrollTop + event.currentTarget.clientHeight
            >= event.currentTarget.scrollHeight - LOG_ROW_HEIGHT
        }}
      >
        {error ? (
          <div className="flex h-full items-center px-4 text-sm text-destructive">
            {error}
          </div>
        ) : total === 0 && isLoading ? (
          <div className="flex h-full items-center px-4 text-sm text-muted-foreground">
            正在加载日志...
          </div>
        ) : total === 0 ? (
          <div className="flex h-full items-center px-4 text-sm text-muted-foreground">
            暂无日志。
          </div>
        ) : (
          <div
            className="relative min-w-full"
            style={{
              height: `${Math.max(total * LOG_ROW_HEIGHT, viewportHeight)}px`,
              width: `${Math.max(contentWidth, viewportWidth)}px`,
            }}
          >
            {visibleRows.map(({ entry, index }) => (
              <div
                key={entry?.id ?? `placeholder-${index}`}
                className="group absolute inset-x-0 flex h-6 select-text items-center bg-transparent text-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                style={{ top: `${index * LOG_ROW_HEIGHT}px` }}
              >
                <div
                  ref={measureRowContent}
                  className="flex min-w-max items-center gap-2.5 px-3"
                >
                  {entry ? (
                    <>
                      <span className={cn("shrink-0 tabular-nums text-muted-foreground", LOG_ROW_HOVER_TEXT_CLASS)}>
                        {formatTimestamp(entry.createdAt)}
                      </span>
                      <span className={cn("shrink-0 whitespace-pre", getLevelClassName(entry))}>
                        {getLevelLabel(entry)}
                      </span>
                      <span className={cn("shrink-0 text-muted-foreground", LOG_ROW_HOVER_TEXT_CLASS)}>
                        {entry.source}:{entry.category}
                      </span>
                      <span className={cn("whitespace-pre", LOG_ROW_HOVER_TEXT_CLASS)}>
                        {normalizeLogText(entry.message)}
                      </span>
                      {entry.details ? (
                        <span className={cn("whitespace-pre text-muted-foreground/90", LOG_ROW_HOVER_TEXT_CLASS)}>
                          {normalizeLogText(entry.details)}
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className={cn("text-muted-foreground", LOG_ROW_HOVER_TEXT_CLASS)}>加载中...</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export { LogsPanel }
