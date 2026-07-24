import type { WorkflowParam } from "../../../src/types/workflow"
import { ScriptWorkflowNodePanel } from "../../script-runtime/renderer/workflow-node-panel"
import type { JavascriptWorkflowConfig } from "../../script-runtime/shared/schema"

export function JavascriptRunNodePanel(props: {
  readonly config: JavascriptWorkflowConfig
  readonly onChange: (config: JavascriptWorkflowConfig) => void
  readonly upstreamNodes: { id: string; name: string }[]
  readonly workflowParams: WorkflowParam[]
}) {
  return <ScriptWorkflowNodePanel {...props} />
}
