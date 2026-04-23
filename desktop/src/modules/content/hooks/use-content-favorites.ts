import { useCallback, useMemo } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseContentType } from "@/types/content"

const logger = createRendererLogger("content.favorite")

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
      const nextFavoriteState = !isCurrentlyFavorite

      const nextIds = isCurrentlyFavorite
        ? currentIds.filter((id) => id !== contentId)
        : [...currentIds, contentId]

      logger.info("Favorite toggle requested.", {
        contentId,
        contentType: type,
        isFavorite: nextFavoriteState,
      })

      try {
        await updateConfig({
          global: {
            favorites: {
              ...favorites,
              [type]: nextIds,
            },
          },
        })
        logger.info("Favorite updated.", {
          contentId,
          contentType: type,
          isFavorite: nextFavoriteState,
        })
      } catch (error) {
        logger.error("Failed to update favorite.", {
          contentId,
          contentType: type,
          isFavorite: nextFavoriteState,
          error,
        })
        throw error
      }
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
