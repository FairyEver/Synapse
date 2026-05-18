import { useEffect, useMemo, useState } from "react"
import { readDetail, readHistory, readHistoryVersion } from "@/app-shell/content"
import { useRepoProfileMap } from "@/app-shell/identity-context"
import { createRendererLogger } from "@/app-shell/logging"
import { resolveDisplayName } from "@/lib/display-name"
import type {
  SynapseContentDetail,
  SynapseContentHistoryEntry,
  SynapseContentMeta,
  SynapseContentType,
  SynapseContentViewMode,
} from "@/types/content"

type SynapseLoadedContentVersion<T extends SynapseContentType = SynapseContentType> =
  SynapseContentDetail<T> & {
    historyDirname: string
    isCurrent: boolean
  }

type UseContentDetailStateArgs<T extends SynapseContentType> = {
  initialHistoryDirname?: string | null
  initialViewMode?: SynapseContentViewMode
  invalidTypeMessage: string
  item: Pick<SynapseContentMeta<T>, "id" | "type"> | null
  loadDetailErrorMessage: string
  loadHistoryErrorMessage: string
  logCategory: string
  open: boolean
  refreshSignal?: number
}

function buildCurrentVersion<T extends SynapseContentType>(
  detail: SynapseContentDetail<T>,
): SynapseLoadedContentVersion<T> {
  return {
    ...detail,
    historyDirname: detail.latestHistoryDirname,
    isCurrent: true,
  }
}

function useContentDetailState<T extends SynapseContentType>({
  initialHistoryDirname = null,
  initialViewMode = "rendered",
  invalidTypeMessage,
  item,
  loadDetailErrorMessage,
  loadHistoryErrorMessage,
  logCategory,
  open,
  refreshSignal = 0,
}: UseContentDetailStateArgs<T>) {
  const logger = useMemo(() => createRendererLogger(logCategory), [logCategory])
  const repoProfileMap = useRepoProfileMap()
  const contentId = item?.id ?? null
  const contentType = item?.type ?? null
  const [detail, setDetail] = useState<SynapseContentDetail<T> | null>(null)
  const [displayedVersion, setDisplayedVersion] = useState<SynapseLoadedContentVersion<T> | null>(null)
  const [history, setHistory] = useState<SynapseContentHistoryEntry[]>([])
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [viewMode, setViewMode] = useState<SynapseContentViewMode>(initialViewMode)
  const [selectedHistoryDirname, setSelectedHistoryDirname] = useState<string | null>(
    initialHistoryDirname,
  )

  useEffect(() => {
    if (!open || contentId === null || contentType === null) {
      setDetail(null)
      setDisplayedVersion(null)
      setHistory([])
      setPreviewError(null)
      setIsLoading(false)
      setViewMode(initialViewMode)
      setSelectedHistoryDirname(initialHistoryDirname)
      return
    }

    let cancelled = false

    setDetail(null)
    setDisplayedVersion(null)
    setHistory([])
    setPreviewError(null)
    setIsLoading(true)
    setViewMode(initialViewMode)
    setSelectedHistoryDirname(initialHistoryDirname)

    void (async () => {
      const startedAt = performance.now()
      logger.info("Content detail load started.", { contentId, contentType })
      try {
        const nextDetail = await readDetail(contentType, contentId)

        if (nextDetail.type !== contentType) {
          throw new Error(invalidTypeMessage)
        }

        if (cancelled) {
          return
        }

        const typedDetail = nextDetail as SynapseContentDetail<T>

        setDetail(typedDetail)
        setDisplayedVersion(buildCurrentVersion(typedDetail))
        setSelectedHistoryDirname(initialHistoryDirname ?? typedDetail.latestHistoryDirname)
        setPreviewError(null)

        // History is best-effort — failure must not block the preview.
        try {
          const nextHistory = await readHistory(contentType, contentId)
          if (!cancelled) {
            setHistory(nextHistory)
            logger.info("Content detail loaded.", { contentId, contentType, historyCount: nextHistory.length, elapsedMs: Math.round(performance.now() - startedAt) })
          }
        } catch (historyError) {
          logger.warn("Failed to load content history.", {
            contentId,
            contentType,
            elapsedMs: Math.round(performance.now() - startedAt),
            historyError,
          })
        }
      } catch (loadError) {
        logger.error("Failed to load content detail.", {
          contentId,
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          loadError,
        })

        if (cancelled) {
          return
        }

        setDetail(null)
        setDisplayedVersion(null)
        setHistory([])
        setPreviewError(
          loadError instanceof Error ? loadError.message : loadDetailErrorMessage,
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    contentId,
    contentType,
    initialHistoryDirname,
    initialViewMode,
    invalidTypeMessage,
    loadDetailErrorMessage,
    logger,
    open,
    refreshSignal,
  ])

  useEffect(() => {
    if (
      !open
      || contentId === null
      || contentType === null
      || !detail
      || !selectedHistoryDirname
      || selectedHistoryDirname === detail.latestHistoryDirname
    ) {
      if (detail) {
        setDisplayedVersion(buildCurrentVersion(detail))
      }

      setPreviewError(null)
      setIsLoading(false)
      return
    }

    let cancelled = false

    setIsLoading(true)
    setPreviewError(null)

    void (async () => {
      const startedAt = performance.now()
      logger.info("History version load started.", { contentId, contentType, historyDirname: selectedHistoryDirname })
      try {
        const nextVersion = await readHistoryVersion(contentType, contentId, selectedHistoryDirname)

        if (nextVersion.type !== contentType) {
          throw new Error(invalidTypeMessage)
        }

        if (cancelled) {
          return
        }

        setDisplayedVersion(nextVersion as SynapseLoadedContentVersion<T>)
        setPreviewError(null)
        logger.info("History version loaded.", { contentId, contentType, historyDirname: selectedHistoryDirname, elapsedMs: Math.round(performance.now() - startedAt) })
      } catch (loadError) {
        logger.error("Failed to load content history version.", {
          contentId,
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          historyDirname: selectedHistoryDirname,
          loadError,
        })

        if (cancelled) {
          return
        }

        setPreviewError(
          loadError instanceof Error ? loadError.message : loadHistoryErrorMessage,
        )
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    contentId,
    contentType,
    detail,
    invalidTypeMessage,
    loadHistoryErrorMessage,
    logger,
    open,
    selectedHistoryDirname,
  ])

  const historyEntries = useMemo(
    () => detail
      ? history.length > 0
        ? history.map((entry) => ({
            ...entry,
            modifiedByDisplayName: resolveDisplayName(
              entry.modifiedBy,
              repoProfileMap,
              entry.modifiedByDisplayName,
            ),
          }))
        : [{
            dirname: detail.latestHistoryDirname,
            modifiedAt: detail.modifiedAt,
            modifiedBy: detail.modifiedBy,
            modifiedByDisplayName: resolveDisplayName(
              detail.modifiedBy,
              repoProfileMap,
              detail.modifiedByDisplayName,
            ),
            deleted: detail.deleted,
            isCurrent: true,
          }]
      : [],
    [detail, history, repoProfileMap],
  )

  return {
    detail,
    displayedVersion,
    historyEntries,
    isLoading,
    previewError,
    selectedHistoryDirname,
    setSelectedHistoryDirname,
    setViewMode,
    viewMode,
  }
}

export { useContentDetailState }
export type { SynapseLoadedContentVersion }
