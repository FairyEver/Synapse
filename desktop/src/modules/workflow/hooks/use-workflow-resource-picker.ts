import { useCallback } from "react"
import type { WorkflowResourceEntryType } from "@/types/workflow"

export function useWorkflowResourcePicker() {
  const chooseResource = useCallback(async (entryType: WorkflowResourceEntryType): Promise<string | null | undefined> => {
    return entryType === "file"
      ? window.synapse?.workflow.paramFile.choose?.()
      : window.synapse?.workflow.paramDirectory.choose?.()
  }, [])

  const chooseResources = useCallback(async (entryType: WorkflowResourceEntryType): Promise<string[] | null | undefined> => {
    return entryType === "file"
      ? window.synapse?.workflow.paramFiles.choose?.()
      : window.synapse?.workflow.paramDirectories.choose?.()
  }, [])

  return { chooseResource, chooseResources }
}
