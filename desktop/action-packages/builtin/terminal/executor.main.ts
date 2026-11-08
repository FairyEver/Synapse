import type { ActionExecutionInput, MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { ActionRunResult } from "../../types"
import { terminalActionManifest } from "./manifest"
import type { TerminalActionConfig } from "./schema"

export type RunAutomationTerminal = (input: ActionExecutionInput<TerminalActionConfig>) => Promise<ActionRunResult>

export function createTerminalAction(deps: { readonly run: RunAutomationTerminal }): MainActionDefinition<TerminalActionConfig> {
  return {
    manifest: terminalActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec", actor: context.actor, resource: config.projectId ? `terminal-project:${config.projectId}` : context.cwd,
      context: { source: "automation", actionType: terminalActionManifest.id, taskId: context.taskId, runId: context.runId,
        ...(config.projectId ? { projectId: config.projectId } : {}) },
    }),
    execute: deps.run,
  }
}
