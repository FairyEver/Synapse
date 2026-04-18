import { useCallback, useEffect, useState } from "react"
import { useAppNotifications } from "@/app-shell/notifications"

type UseContentCreationStateResult = {
  handleCreated: (message?: string) => void
  isCreateDialogOpen: boolean
  refreshSignal: number
  setIsCreateDialogOpen: (open: boolean) => void
}

function useContentCreationState(
  onCreateDialogOpenChange?: (open: boolean) => void,
): UseContentCreationStateResult {
  const { success } = useAppNotifications()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [refreshSignal, setRefreshSignal] = useState(0)

  useEffect(() => {
    onCreateDialogOpenChange?.(isCreateDialogOpen)
  }, [isCreateDialogOpen, onCreateDialogOpenChange])

  useEffect(() => {
    return () => {
      onCreateDialogOpenChange?.(false)
    }
  }, [onCreateDialogOpenChange])

  const handleCreated = useCallback((message?: string) => {
    setRefreshSignal((currentSignal) => currentSignal + 1)
    success(message ?? "已保存。")
  }, [success])

  return {
    handleCreated,
    isCreateDialogOpen,
    refreshSignal,
    setIsCreateDialogOpen,
  }
}

export { useContentCreationState }
