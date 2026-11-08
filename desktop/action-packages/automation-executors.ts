import { agentActionManifest } from "./builtin/agent/manifest"
import { claudeCodeActionManifest } from "./builtin/claude-code/manifest"
import { terminalActionManifest } from "./builtin/terminal/manifest"

/** Shared with the retirement Worker and its queued deletion recheck. */
export const supportedAutomationExecutorTypes: readonly string[] = [agentActionManifest.id, claudeCodeActionManifest.id, terminalActionManifest.id]

export function isSupportedAutomationExecutor(type: string): boolean {
  return supportedAutomationExecutorTypes.includes(type)
}

/** 历史退役清单，不把当前客户端不认识的未来类型当作待删除数据。 */
export const retiredAutomationExecutorTypes: readonly string[] = [
  "builtin.command", "builtin.script", "builtin.http-request", "builtin.workflow",
  "builtin.javascript-run", "builtin.nodejs-run",
]

export function isRetiredAutomationExecutor(type: string): boolean {
  return retiredAutomationExecutorTypes.includes(type)
}
