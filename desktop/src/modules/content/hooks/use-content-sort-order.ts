import { useCallback } from "react"
import { useAppConfig } from "@/app-shell/config"
import { createRendererLogger } from "@/app-shell/logging"
import { useAppNotifications } from "@/app-shell/notifications"
import type { SynapseContentSortOrder } from "@/types/config"

const logger = createRendererLogger("content.sort")

export function useContentSortOrder() {
  const { config, updateConfig } = useAppConfig()
  const { error: notifyError } = useAppNotifications()

  const sortOrder = config.global.contentSortOrder

  const setSortOrder = useCallback(
    async (nextSortOrder: SynapseContentSortOrder) => {
      logger.info("Sort order changed.", { from: config.global.contentSortOrder, to: nextSortOrder })
      try {
        await updateConfig({
          global: { contentSortOrder: nextSortOrder },
        })
      } catch (error) {
        logger.error("Failed to save content sort order.", {
          error,
          from: config.global.contentSortOrder,
          to: nextSortOrder,
        })
        notifyError("排序保存失败，请稍后重试。")
      }
    },
    [config.global.contentSortOrder, notifyError, updateConfig],
  )

  return { sortOrder, setSortOrder }
}
