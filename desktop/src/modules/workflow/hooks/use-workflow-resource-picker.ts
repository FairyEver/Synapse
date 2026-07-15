import { useCallback } from "react"
import type { WorkflowResourceEntryType } from "@/types/workflow"

export function useWorkflowResourcePicker() {
  const chooseResource = useCallback(async (entryType: WorkflowResourceEntryType): Promise<string | null | undefined> => {
    return entryType === "file"
      ? window.synapse?.workflow.chooseParamFile?.()
      : window.synapse?.workflow.chooseParamDirectory?.()
  }, [])

  const chooseResources = useCallback(async (entryType: WorkflowResourceEntryType): Promise<string[] | null | undefined> => {
    return entryType === "file"
      ? window.synapse?.workflow.chooseParamFiles?.()
      : window.synapse?.workflow.chooseParamDirectories?.()
  }, [])

  return { chooseResource, chooseResources }
}
