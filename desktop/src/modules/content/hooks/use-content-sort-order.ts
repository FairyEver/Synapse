import { useCallback } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import type { SynapseContentSortOrder } from "@/types/config"

const logger = createRendererLogger("content.sort")

export function useContentSortOrder() {
  const { config, updateConfig } = useAppConfig()

  const sortOrder = config.global.contentSortOrder

  const setSortOrder = useCallback(
    async (nextSortOrder: SynapseContentSortOrder) => {
      logger.info("Sort order changed.", { from: config.global.contentSortOrder, to: nextSortOrder })
      await updateConfig({
        global: { contentSortOrder: nextSortOrder },
      })
    },
    [config.global.contentSortOrder, updateConfig],
  )

  return { sortOrder, setSortOrder }
}
