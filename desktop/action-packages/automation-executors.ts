import { agentActionManifest } from "./builtin/agent/manifest"
import { claudeCodeActionManifest } from "./builtin/claude-code/manifest"

/** Shared with the retirement Worker and its queued deletion recheck. */
export const supportedAutomationExecutorTypes: readonly string[] = [agentActionManifest.id, claudeCodeActionManifest.id]

export function isSupportedAutomationExecutor(type: string): boolean {
  return supportedAutomationExecutorTypes.includes(type)
}
