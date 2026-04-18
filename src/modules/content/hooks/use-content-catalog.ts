import { useCallback, useEffect, useMemo, useState } from "react"
import { hasContentBridge, readRules, readSkills } from "@/app-shell/content"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useRepositoryManager } from "@/app-shell/repository"
import { buildCategoryStats } from "@/lib/content-categories"
import type { SynapseCategoryViewItem } from "@/types/category"
import type {
  SynapseContentMeta,
  SynapseContentType,
  SynapseRuleMeta,
  SynapseSkillMeta,
} from "@/types/content"

type SynapseContentItemsByType = {
  rule: SynapseRuleMeta[]
  skill: SynapseSkillMeta[]
}

type UseContentCatalogResult<T extends SynapseContentType> = {
  categories: SynapseCategoryViewItem[]
  error: string | null
  isLoading: boolean
  items: SynapseContentItemsByType[T]
  refresh: () => Promise<void>
  totalCount: number
}

function createEmptyItems<T extends SynapseContentType>(): SynapseContentItemsByType[T] {
  return [] as SynapseContentItemsByType[T]
}

function useContentCatalog<T extends SynapseContentType>(
  contentType: T,
): UseContentCatalogResult<T> {
  const logger = useMemo(() => createRendererLogger(`content.catalog.${contentType}`), [contentType])
  const { activeRepository } = useAppConfig()
  const { operations, states } = useRepositoryManager()
  const activeRepositoryState = activeRepository ? states[activeRepository.uuid] : null
  const activeRepositoryOperation = activeRepository ? operations[activeRepository.uuid] : null
  const [items, setItems] = useState<SynapseContentItemsByType[T]>(() => createEmptyItems<T>())
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!activeRepository) {
      setItems(createEmptyItems<T>())
      setError(null)
      setIsLoading(false)
      return
    }

    if (!hasContentBridge()) {
      setItems(createEmptyItems<T>())
      setError("当前页面没有加载内容桥接，无法读取当前目录。")
      setIsLoading(false)
      return
    }

    setIsLoading(true)

    try {
      const nextItems = (
        contentType === "rule" ? await readRules() : await readSkills()
      ) as SynapseContentItemsByType[T]
      const nextStats = buildCategoryStats(contentType, nextItems as SynapseContentMeta[])

      setItems(nextItems)
      setError(null)

      if (nextStats.unknownCategoryIds.length > 0) {
        logger.warn("Unrecognized content categories detected.", {
          contentType,
          repositoryUuid: activeRepository.uuid,
          unknownCategoryIds: nextStats.unknownCategoryIds,
        })
      }
    } catch (loadError) {
      logger.error("Failed to load content catalog.", loadError)
      setItems(createEmptyItems<T>())
      setError(loadError instanceof Error ? loadError.message : "读取内容失败。")
    } finally {
      setIsLoading(false)
    }
  }, [activeRepository, contentType, logger])

  useEffect(() => {
    void refresh().catch((loadError) => {
      logger.error("Unexpected content catalog refresh failure.", loadError)
    })
  }, [
    activeRepository?.uuid,
    activeRepositoryOperation?.completedAt,
    activeRepositoryState?.status,
    logger,
    refresh,
  ])

  const stats = useMemo(
    () => buildCategoryStats(contentType, items as SynapseContentMeta[]),
    [contentType, items],
  )

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
