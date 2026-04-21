import { useCallback } from "react"
import { useAppConfig } from "@/app-shell/config"
import type { SynapseContentSortOrder } from "@/types/config"

export function useContentSortOrder() {
  const { config, updateConfig } = useAppConfig()

  const sortOrder = config.global.contentSortOrder

  const setSortOrder = useCallback(
    async (nextSortOrder: SynapseContentSortOrder) => {
      await updateConfig({
        global: { contentSortOrder: nextSortOrder },
      })
    },
    [updateConfig],
  )

  return { sortOrder, setSortOrder }
}
