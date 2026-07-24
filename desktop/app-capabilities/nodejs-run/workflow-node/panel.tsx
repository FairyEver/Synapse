import type { WorkflowParam } from "../../../src/types/workflow"
import { ScriptWorkflowNodePanel } from "../../script-runtime/renderer/workflow-node-panel"
import type { NodejsWorkflowConfig } from "../../script-runtime/shared/schema"

export function NodejsRunNodePanel(props: {
  readonly config: NodejsWorkflowConfig
  readonly onChange: (config: NodejsWorkflowConfig) => void
  readonly upstreamNodes: { id: string; name: string }[]
  readonly workflowParams: WorkflowParam[]
}) {
  return <ScriptWorkflowNodePanel {...props} nodejs />
}
