import type { ControlledProcessRunner } from "../../../electron/runtime/process"
import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { runShellAction } from "../shell-process.main"
import { commandActionManifest } from "./manifest"
import type { CommandActionConfig } from "./schema"

export function createCommandAction(deps: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
}): MainActionDefinition<CommandActionConfig> {
  return {
    manifest: commandActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "shell.exec",
      actor: context.actor,
      resource: commandActionManifest.id,
      context: {
        source: "task-scheduler",
        actionType: commandActionManifest.id,
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
        content: input.config.command,
        config: input.config,
        context: input.context,
      }),
  }
}
