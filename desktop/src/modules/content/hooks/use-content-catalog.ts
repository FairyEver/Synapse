import { useCallback, useMemo } from "react"
import { useContentList } from "@/app-shell/use-repository-manager"
import { buildCategoryStats } from "@/lib/content-categories"
import type { SynapseCategoryViewItem } from "@/types/category"
import type { SynapseContentMeta, SynapseContentType } from "@/types/content"

type UseContentCatalogResult<T extends SynapseContentType> = {
  categories: SynapseCategoryViewItem[]
  error: Error | null
  isLoading: boolean
  items: SynapseContentMeta<T>[]
  refresh: () => Promise<void>
  totalCount: number
}

function useContentCatalog<T extends SynapseContentType>(
  contentType: T,
  _refreshSignal?: number,
): UseContentCatalogResult<T> {
  // 使用新的 RepositoryManager 提供的 hook
  const { items, isLoading, error, refresh } = useContentList<T>(contentType)

  // 计算分类统计
  const stats = useMemo(() => buildCategoryStats(contentType, items), [contentType, items])

  return {
    categories: stats.items,
    error,
    isLoading,
    items,
    refresh,
    totalCount: stats.totalCount,
  }
}

export { useContentCatalog }
