import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  createRendererLogger,
  exportLogs,
  hasLogBridge,
  readLogList,
  readLogSummary,
  subscribeToLogAppends,
} from "@/app-shell/logging"
import type { SynapseLogEntry } from "@/types/log"

const LOG_PAGE_SIZE = 200

function getPageIndex(entryIndex: number): number {
  return Math.floor(entryIndex / LOG_PAGE_SIZE)
}

function getEntryOffset(entryIndex: number): number {
  return entryIndex % LOG_PAGE_SIZE
}

function useLogFeed() {
  const logger = useMemo(() => createRendererLogger("logs.feed"), [])
  const [pages, setPages] = useState<Record<number, SynapseLogEntry[]>>({})
  const [total, setTotal] = useState(0)
  const [isLoading, setIsLoading] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null)
  const pagesRef = useRef<Record<number, SynapseLogEntry[]>>({})
  const loadingPagesRef = useRef(new Set<number>())

  const storePage = useCallback((pageIndex: number, entries: SynapseLogEntry[]) => {
    setPages((currentPages) => {
      const nextPages = {
        ...currentPages,
        [pageIndex]: entries,
      }

      pagesRef.current = nextPages
      return nextPages
    })
  }, [])

  const loadPage = useCallback(async (pageIndex: number) => {
    if (pageIndex < 0) {
      return []
    }

    const cachedEntries = pagesRef.current[pageIndex]

    if (cachedEntries) {
      return cachedEntries
    }

    if (loadingPagesRef.current.has(pageIndex)) {
      return []
    }

    loadingPagesRef.current.add(pageIndex)

    try {
      const result = await readLogList({
        offset: pageIndex * LOG_PAGE_SIZE,
        limit: LOG_PAGE_SIZE,
      })

      setTotal(result.total)
      storePage(pageIndex, result.entries)
      setError(null)

      return result.entries
    } catch (loadError) {
      logger.error("Failed to load log page.", {
        loadError,
        pageIndex,
      })
      setError(loadError instanceof Error ? loadError.message : "加载日志失败。")

      return []
    } finally {
      loadingPagesRef.current.delete(pageIndex)
    }
  }, [logger, storePage])

  const ensureRangeLoaded = useCallback((startIndex: number, endIndex: number) => {
    const safeStartIndex = Math.max(0, startIndex)
    const safeEndIndex = Math.max(safeStartIndex, endIndex)
    const pageStart = getPageIndex(safeStartIndex)
    const pageEnd = getPageIndex(safeEndIndex)

    for (let pageIndex = pageStart; pageIndex <= pageEnd; pageIndex += 1) {
      void loadPage(pageIndex)
    }
  }, [loadPage])

  useEffect(() => {
    let cancelled = false

    void (async () => {
      try {
        if (!hasLogBridge()) {
          setError("当前页面没有 Electron 日志桥接。请确认你操作的是 Synapse 窗口，而不是浏览器预览页。")
          return
        }

        const summary = await readLogSummary()

        if (cancelled) {
          return
        }

        setTotal(summary.total)

        if (summary.total > 0) {
          const lastIndex = summary.total - 1
          const lastPageEntries = await loadPage(getPageIndex(lastIndex))

          if (cancelled) {
            return
          }

          setSelectedEntryId(lastPageEntries.at(-1)?.id ?? null)
        } else {
          setSelectedEntryId(null)
        }
      } catch (loadError) {
        logger.error("Failed to load log summary.", loadError)
        setError(loadError instanceof Error ? loadError.message : "加载日志失败。")
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadPage, logger])

  useEffect(() => {
    return subscribeToLogAppends((event) => {
      setTotal(event.total)
      setPages((currentPages) => {
        const nextPages = { ...currentPages }
        const entryIndex = event.total - 1
        const pageIndex = getPageIndex(entryIndex)
        const cachedEntries = nextPages[pageIndex]

        if (cachedEntries) {
          const nextEntries = [...cachedEntries]
          nextEntries[getEntryOffset(entryIndex)] = event.entry
          nextPages[pageIndex] = nextEntries
        }

        pagesRef.current = nextPages
        return nextPages
      })

      setSelectedEntryId((currentSelectedEntryId) => currentSelectedEntryId ?? event.entry.id)
    })
  }, [])

  const selectedEntry = useMemo(() => {
    if (selectedEntryId === null) {
      return null
    }

    for (const pageEntries of Object.values(pages)) {
      const matchedEntry = pageEntries.find((entry) => entry.id === selectedEntryId)

      if (matchedEntry) {
        return matchedEntry
      }
    }

    return null
  }, [pages, selectedEntryId])

  const getEntryAtIndex = useCallback((entryIndex: number): SynapseLogEntry | null => {
    const pageEntries = pagesRef.current[getPageIndex(entryIndex)]

    return pageEntries?.[getEntryOffset(entryIndex)] ?? null
  }, [])

  const exportLogFile = useCallback(async () => {
    setIsExporting(true)

    try {
      const result = await exportLogs()
      logger.info("Log file exported from renderer.", result)
      return result
    } catch (exportError) {
      logger.error("Failed to export log file.", exportError)
      setError(exportError instanceof Error ? exportError.message : "导出日志失败。")
      throw exportError
    } finally {
      setIsExporting(false)
    }
  }, [logger])

  return {
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
  }
}

export { LOG_PAGE_SIZE, useLogFeed }
