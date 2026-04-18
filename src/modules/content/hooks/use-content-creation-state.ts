import { useCallback, useEffect, useState } from "react"

type UseContentCreationStateResult = {
  handleCreated: () => void
  isCreateDialogOpen: boolean
  refreshSignal: number
  setIsCreateDialogOpen: (open: boolean) => void
}

function useContentCreationState(
  onCreateDialogOpenChange?: (open: boolean) => void,
): UseContentCreationStateResult {
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

  const handleCreated = useCallback(() => {
    setRefreshSignal((currentSignal) => currentSignal + 1)
  }, [])

  return {
    handleCreated,
    isCreateDialogOpen,
    refreshSignal,
    setIsCreateDialogOpen,
  }
}

export { useContentCreationState }
