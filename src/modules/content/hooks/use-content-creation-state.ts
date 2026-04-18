import { useCallback, useEffect, useState } from "react"

type UseContentCreationStateResult = {
  dismissNotice: () => void
  handleCreated: (message?: string) => void
  isCreateDialogOpen: boolean
  notice: string | null
  refreshSignal: number
  setIsCreateDialogOpen: (open: boolean) => void
}

function useContentCreationState(
  onCreateDialogOpenChange?: (open: boolean) => void,
): UseContentCreationStateResult {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
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
    setNotice(message ?? "已提交审核，列表已刷新。")
  }, [])

  const dismissNotice = useCallback(() => {
    setNotice(null)
  }, [])

  return {
    dismissNotice,
    handleCreated,
    isCreateDialogOpen,
    notice,
    refreshSignal,
    setIsCreateDialogOpen,
  }
}

export { useContentCreationState }
