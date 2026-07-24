import type { NodejsWorkflowConfig } from "../../script-runtime/shared/schema"
import { ScriptWorkflowNodeCard } from "../../script-runtime/renderer/workflow-node-card"
import { nodejsRunNodeManifest } from "./manifest"
import type { NodeStatus } from "../../../workflow-nodes/node-status-utils"

export function NodejsRunNodeCard(props: {
  readonly config: NodejsWorkflowConfig
  readonly name?: string
  readonly selected?: boolean
  readonly status?: NodeStatus
  readonly progressLabel?: string
  readonly startedAt?: number
  readonly nodeId?: string
}) {
  const summary = nodejsRunNodeManifest.cardSummary(props.config)
  return <ScriptWorkflowNodeCard {...props} icon={nodejsRunNodeManifest.icon} {...summary} />
}
