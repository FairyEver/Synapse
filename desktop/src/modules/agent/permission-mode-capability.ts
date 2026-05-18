import type { SynapseAgentPermissionMode } from "@/types/agent"

type PermissionModeCapability =
  | "current"
  | "switchable"
  | "confirmable"
  | "requiresNewSession"

function getPermissionModeCapability(input: {
  readonly currentMode: SynapseAgentPermissionMode
  readonly targetMode: SynapseAgentPermissionMode
}): PermissionModeCapability {
  if (input.currentMode === input.targetMode) {
    return "current"
  }

  if (input.targetMode === "bypassPermissions") {
    return "requiresNewSession"
  }

  if (input.targetMode === "auto") {
    return "confirmable"
  }

  return "switchable"
}

export { getPermissionModeCapability }
export type { PermissionModeCapability }
