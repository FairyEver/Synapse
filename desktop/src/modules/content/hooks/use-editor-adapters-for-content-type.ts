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
    () => (adapters ?? []).filter((adapter) => (
      adapter.supportedContentTypes.includes(contentType)
    )),
    [adapters, contentType],
  )

  const load = useCallback(() => {
    if (!enabled || isLoading || adapters) {
      return
    }

    setIsLoading(true)
    setError(null)
    const startedAt = performance.now()

    logger.info("Loading editor targets.", { contentType })

    void getEditorAdapters()
      .then((nextAdapters) => {
        setAdapters(nextAdapters)
        logger.info("Editor targets loaded.", {
          adapterCount: nextAdapters.length,
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          supportedCount: nextAdapters.filter((adapter) => (
            adapter.supportedContentTypes.includes(contentType)
          )).length,
        })
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "读取编辑器列表失败。")
        logger.error("Failed to load editor targets.", {
          contentType,
          elapsedMs: Math.round(performance.now() - startedAt),
          error: err,
        })
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [adapters, contentType, enabled, isLoading, logger])

  return {
    error,
    filteredAdapters,
    isLoading,
    load,
  }
}

export { useEditorAdaptersForContentType }
