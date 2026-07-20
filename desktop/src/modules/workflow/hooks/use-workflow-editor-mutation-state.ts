import { useEffect } from "react"
import { createRendererLogger } from "@/app-shell/logging"

const logger = createRendererLogger("workflow.editor-mutation-state")

export function useWorkflowEditorMutationState(workflowId: string, dirty: boolean, saving: boolean): void {
  useEffect(() => {
    const updateState = window.synapse?.workflow.operation.setEditorMutationState
    if (!updateState || !workflowId) return
    void updateState(workflowId, dirty, saving).catch((error) => {
      logger.warn("Workflow editor mutation state sync failed.", {
        boundary: "renderer.workflow.editor.mutation-state",
        workflowId,
        errorName: error instanceof Error ? error.name : typeof error,
      })
    })
  }, [workflowId, dirty, saving])

  useEffect(() => {
    const updateState = window.synapse?.workflow.operation.setEditorMutationState
    if (!updateState || !workflowId) return
    return () => {
      void updateState(workflowId, false, false).catch((error) => {
        logger.warn("Workflow editor mutation state cleanup failed.", {
          boundary: "renderer.workflow.editor.mutation-state-cleanup",
          workflowId,
          errorName: error instanceof Error ? error.name : typeof error,
        })
      })
    }
  }, [workflowId])
}
