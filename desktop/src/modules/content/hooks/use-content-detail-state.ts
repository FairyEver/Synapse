import { useEffect, useMemo, useState } from "react"
import { readDetail } from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import type {
  SynapseContentDetail,
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
  initialViewMode?: SynapseContentViewMode
  invalidTypeMessage: string
  item: Pick<SynapseContentMeta<T>, "id" | "type"> | null
  loadDetailErrorMessage: string
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
  initialViewMode = "rendered",
  invalidTypeMessage,
  item,
  loadDetailErrorMessage,
  logCategory,
  open,
  refreshSignal = 0,
}: UseContentDetailStateArgs<T>) {
  const logger = useMemo(() => createRendererLogger(logCategory), [logCategory])
  const contentId = item?.id ?? null
  const contentType = item?.type ?? null
  const [detail, setDetail] = useState<SynapseContentDetail<T> | null>(null)
  const [displayedVersion, setDisplayedVersion] = useState<SynapseLoadedContentVersion<T> | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [viewMode, setViewMode] = useState<SynapseContentViewMode>(initialViewMode)

  useEffect(() => {
    if (!open || contentId === null || contentType === null) {
      setDetail(null)
      setDisplayedVersion(null)
      setPreviewError(null)
      setIsLoading(false)
      setViewMode(initialViewMode)
      return
    }

    let cancelled = false

    setDetail(null)
    setDisplayedVersion(null)
    setPreviewError(null)
    setIsLoading(true)
    setViewMode(initialViewMode)

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
        setPreviewError(null)
        logger.info("Content detail loaded.", { contentId, contentType, elapsedMs: Math.round(performance.now() - startedAt) })
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
    initialViewMode,
    invalidTypeMessage,
    loadDetailErrorMessage,
    logger,
    open,
    refreshSignal,
  ])

  return {
    detail,
    displayedVersion,
    isLoading,
    previewError,
    setViewMode,
    viewMode,
  }
}

export { useContentDetailState }
export type { SynapseLoadedContentVersion }
