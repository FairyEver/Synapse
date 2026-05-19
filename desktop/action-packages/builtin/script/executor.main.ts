import type { ControlledProcessRunner } from "../../../electron/runtime/process"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { runShellAction } from "../shell-process.main"
import { scriptActionManifest } from "./manifest"
import type { ScriptActionConfig } from "./schema"

export function createScriptAction(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionDefinition<ScriptActionConfig> {
  return {
    manifest: scriptActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: scriptActionManifest.id,
      context: {
        source: "task-scheduler",
        actionType: scriptActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        shell: config.shell,
        cwd: context.cwd,
        envKeys: config.env ? Object.keys(config.env).sort() : [],
        timeoutMins: config.timeoutMins,
      },
    }),
    execute: (input) =>
      runShellAction({
        ...deps,
        content: input.config.script,
        config: input.config,
        context: input.context,
      }),
  }
}
