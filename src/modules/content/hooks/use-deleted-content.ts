import { useCallback, useEffect, useState } from "react"
import { listDeletedContent } from "@/app-shell/content"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type UseDeletedContentResult = {
  count: number
  error: Error | null
  isLoading: boolean
  items: SynapseContentMeta[]
  refresh: () => Promise<void>
}

function useDeletedContent(contentType: SynapseContentType): UseDeletedContentResult {
  const [items, setItems] = useState<SynapseContentMeta[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const result = await listDeletedContent(contentType)
      setItems(result)
    } catch (err) {
      setError(err instanceof Error ? err : new Error("加载已删除内容失败。"))
    } finally {
      setIsLoading(false)
    }
  }, [contentType])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    count: items.length,
    error,
    isLoading,
    items,
    refresh,
  }
}

export { useDeletedContent }
