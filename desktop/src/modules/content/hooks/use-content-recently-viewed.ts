import { useCallback, useMemo } from "react"
import { useAppConfig } from "@/app-shell/config"
import type { SynapseContentType } from "@/types/content"

const MAX_RECENTLY_VIEWED = 100

export function useContentRecentlyViewed(contentType?: SynapseContentType) {
  const { config, updateConfig } = useAppConfig()

  const recentlyViewed = config?.global.recentlyViewed ?? { rule: [], skill: [], prompt: [] }

  const recentlyViewedIds = useMemo(() => {
    if (!contentType) return []
    return recentlyViewed[contentType] ?? []
  }, [recentlyViewed, contentType])

  const hasRecentlyViewed = useCallback(
    (type: SynapseContentType) => {
      return (recentlyViewed[type] ?? []).length > 0
    },
    [recentlyViewed],
  )

  const addRecentlyViewed = useCallback(
    async (type: SynapseContentType, contentId: string) => {
      const currentIds = recentlyViewed[type] ?? []
      const nextIds = [contentId, ...currentIds.filter((id) => id !== contentId)].slice(0, MAX_RECENTLY_VIEWED)

      await updateConfig({
        global: {
          recentlyViewed: {
            ...recentlyViewed,
            [type]: nextIds,
          },
        },
      })
    },
    [recentlyViewed, updateConfig],
  )

  return {
    recentlyViewed,
    recentlyViewedIds,
    hasRecentlyViewed,
    addRecentlyViewed,
  }
}
