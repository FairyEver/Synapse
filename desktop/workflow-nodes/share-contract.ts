import type { NodeShareCapabilityRequirement } from "./types"

export const BUILTIN_WORKFLOW_NODE_CAPABILITY_VERSION = "1.0.0"

export function builtinWorkflowNodeCapability(type: string): NodeShareCapabilityRequirement {
  return {
    id: `workflow.node.${type}`,
    minVersion: BUILTIN_WORKFLOW_NODE_CAPABILITY_VERSION,
    installSourceId: "synapse.builtin",
  }
}
