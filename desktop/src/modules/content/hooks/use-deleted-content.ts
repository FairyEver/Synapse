import { useCallback, useEffect, useMemo, useState } from "react"
import { listDeletedContent } from "@/app-shell/content"
import { createRendererLogger } from "@/app-shell/logging"
import { useRepositoryManager } from "@/app-shell/repository"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type UseDeletedContentResult = {
  count: number
  error: Error | null
  isLoading: boolean
  items: SynapseContentMeta[]
  refresh: () => Promise<void>
}

function useDeletedContent(contentType: SynapseContentType): UseDeletedContentResult {
  const manager = useRepositoryManager()
  const logger = useMemo(() => createRendererLogger("content.deleted"), [])
  const [items, setItems] = useState<SynapseContentMeta[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setIsLoading(true)
    setError(null)
    const startedAt = performance.now()

    try {
      const result = await listDeletedContent(contentType)
      if (signal?.aborted) return
      setItems(result)
      logger.info("Deleted content loaded.", { contentType, count: result.length, elapsedMs: Math.round(performance.now() - startedAt) })
    } catch (err) {
      if (signal?.aborted) return
      logger.error("Failed to load deleted content.", { contentType, elapsedMs: Math.round(performance.now() - startedAt), error: err })
      setError(err instanceof Error ? err : new Error("加载已删除内容失败。"))
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false)
      }
    }
  }, [contentType, logger])

  useEffect(() => {
    const controller = new AbortController()
    void refresh(controller.signal)
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    const controller = new AbortController()
    const unsubscribe = manager.subscribeToContentChanges(contentType, () => {
      void refresh(controller.signal)
    })

    return () => {
      controller.abort()
      unsubscribe()
    }
  }, [contentType, manager, refresh])

  return {
    count: items.length,
    error,
    isLoading,
    items,
    refresh,
  }
}

export { useDeletedContent }
