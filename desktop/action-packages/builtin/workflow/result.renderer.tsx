import type { ActionRunResult } from "../../types"
import { ActionResultView } from "../../../src/action-runtime/action-result-view"
import { Button } from "../../../src/components/ui/button"
import type { WorkflowActionOutputs } from "./schema"

export function WorkflowActionResultView({ result }: { readonly result: ActionRunResult }) {
  const outputs = result.outputs as WorkflowActionOutputs | undefined
  if (!outputs?.workflowId || !outputs.workflowRunId) {
    return <ActionResultView result={result} />
  }
  const workflowId = outputs.workflowId
  const workflowRunId = outputs.workflowRunId

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <ActionResultView result={result} />
      <div className="flex items-center gap-2">
        <span className="truncate text-xs text-muted-foreground">{outputs.workflowName}</span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={(event) => {
            event.stopPropagation()
            void window.synapse?.workflow.operation.openRunner(workflowId, workflowRunId)
          }}
        >
          打开运行记录
        </Button>
      </div>
    </div>
  )
}
