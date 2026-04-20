import { useCallback, useMemo } from "react"
import { useAppConfig } from "@/app-shell/config"
import type { SynapseContentType } from "@/types/content"

export function useContentFavorites(contentType?: SynapseContentType) {
  const { config, updateConfig } = useAppConfig()

  const favorites = config?.global.favorites ?? { rule: [], skill: [], prompt: [] }

  const favoriteIds = useMemo(() => {
    if (!contentType) return []
    return favorites[contentType] ?? []
  }, [favorites, contentType])

  const hasFavorites = useCallback(
    (type: SynapseContentType) => {
      return (favorites[type] ?? []).length > 0
    },
    [favorites],
  )

  const isFavorite = useCallback(
    (type: SynapseContentType, contentId: string) => {
      return (favorites[type] ?? []).includes(contentId)
    },
    [favorites],
  )

  const toggleFavorite = useCallback(
    async (type: SynapseContentType, contentId: string) => {
      const currentIds = favorites[type] ?? []
      const isCurrentlyFavorite = currentIds.includes(contentId)

      const nextIds = isCurrentlyFavorite
        ? currentIds.filter((id) => id !== contentId)
        : [...currentIds, contentId]

      await updateConfig({
        global: {
          favorites: {
            ...favorites,
            [type]: nextIds,
          },
        },
      })
    },
    [favorites, updateConfig],
  )

  return {
    favorites,
    favoriteIds,
    hasFavorites,
    isFavorite,
    toggleFavorite,
  }
}
