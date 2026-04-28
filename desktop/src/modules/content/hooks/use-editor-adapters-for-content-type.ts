import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getEditorAdapters } from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseContentType } from "@/types/content"
import type { SynapseEditorAdapterSummary } from "@/types/editor"

type UseEditorAdaptersForContentTypeProps = {
  contentType: SynapseContentType
  enabled: boolean
  loggerName: string
}

function filterAdaptersForContentType(
  adapters: SynapseEditorAdapterSummary[],
  contentType: SynapseContentType,
): SynapseEditorAdapterSummary[] {
  return adapters.filter((adapter) => adapter.supportedContentTypes.includes(contentType))
}

function useEditorAdaptersForContentType({
  contentType,
  enabled,
  loggerName,
}: UseEditorAdaptersForContentTypeProps) {
  const logger = useMemo(() => createRendererLogger(loggerName), [loggerName])
  const [adapters, setAdapters] = useState<SynapseEditorAdapterSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const loadPromiseRef = useRef<Promise<SynapseEditorAdapterSummary[]> | null>(null)

  useEffect(() => {
    setAdapters(null)
    setError(null)
    setIsLoading(false)
    loadPromiseRef.current = null
  }, [contentType])

  const filteredAdapters = useMemo(
    () => filterAdaptersForContentType(adapters ?? [], contentType),
    [adapters, contentType],
  )

  const load = useCallback(async (): Promise<SynapseEditorAdapterSummary[]> => {
    if (!enabled || adapters) {
      return filteredAdapters
    }

    if (loadPromiseRef.current) {
      return loadPromiseRef.current
    }

    setIsLoading(true)
    setError(null)
    const startedAt = performance.now()

    logger.info("Loading editor targets.", { contentType })

    const loadPromise = getEditorAdapters()
      .then((nextAdapters) => {
        const nextFilteredAdapters = filterAdaptersForContentType(nextAdapters, contentType)

        setAdapters(nextAdapters)
        logger.info("Editor targets loaded.", {
          adapterCount: nextAdapters.length,
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          supportedCount: nextFilteredAdapters.length,
        })

        return nextFilteredAdapters
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "读取编辑器列表失败。")
        logger.error("Failed to load editor targets.", {
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          error: err,
        })

        return []
      })
      .finally(() => {
        setIsLoading(false)
        loadPromiseRef.current = null
      })

    loadPromiseRef.current = loadPromise
    return loadPromise
  }, [adapters, contentType, enabled, filteredAdapters, logger])

  return {
    error,
    filteredAdapters,
    isLoading,
    load,
  }
}

export { filterAdaptersForContentType, useEditorAdaptersForContentType }
