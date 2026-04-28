import { useCallback, useEffect, useMemo, useState } from "react"
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

  useEffect(() => {
    setAdapters(null)
    setError(null)
    setIsLoading(false)
  }, [contentType])

  const filteredAdapters = useMemo(
    () => filterAdaptersForContentType(adapters ?? [], contentType),
    [adapters, contentType],
  )

  const load = useCallback(async (): Promise<SynapseEditorAdapterSummary[]> => {
    if (!enabled || isLoading || adapters) {
      return filteredAdapters
    }

    setIsLoading(true)
    setError(null)
    const startedAt = performance.now()

    logger.info("Loading editor targets.", { contentType })

    try {
      const nextAdapters = await getEditorAdapters()
      const nextFilteredAdapters = filterAdaptersForContentType(nextAdapters, contentType)

      setAdapters(nextAdapters)
      logger.info("Editor targets loaded.", {
        adapterCount: nextAdapters.length,
        contentType,
        elapsedMs: Math.round(performance.now() - startedAt),
        supportedCount: nextFilteredAdapters.length,
      })

      return nextFilteredAdapters
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取编辑器列表失败。")
      logger.error("Failed to load editor targets.", {
        contentType,
        elapsedMs: Math.round(performance.now() - startedAt),
        error: err,
      })

      return []
    } finally {
      setIsLoading(false)
    }
  }, [adapters, contentType, enabled, filteredAdapters, isLoading, logger])

  return {
    error,
    filteredAdapters,
    isLoading,
    load,
  }
}

export { filterAdaptersForContentType, useEditorAdaptersForContentType }
