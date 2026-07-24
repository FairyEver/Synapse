import type { JavascriptWorkflowConfig } from "../../script-runtime/shared/schema"
import { ScriptWorkflowNodeCard } from "../../script-runtime/renderer/workflow-node-card"
import { javascriptRunNodeManifest } from "./manifest"
import type { NodeStatus } from "../../../workflow-nodes/node-status-utils"

export function JavascriptRunNodeCard(props: {
  readonly config: JavascriptWorkflowConfig
  readonly name?: string
  readonly selected?: boolean
  readonly status?: NodeStatus
  readonly progressLabel?: string
  readonly startedAt?: number
  readonly nodeId?: string
}) {
  const summary = javascriptRunNodeManifest.cardSummary(props.config)
  return <ScriptWorkflowNodeCard {...props} icon={javascriptRunNodeManifest.icon} {...summary} />
}
