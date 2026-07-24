import type { NoAuthorizationMainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { SecretsService } from "../../secrets/main/service"
import { createScriptAutomationAction } from "../../script-runtime/main/execution-adapters"
import type { ScriptRuntimeService } from "../../script-runtime/main/service"
import type { NodejsAutomationConfig } from "../../script-runtime/shared/schema"
import { nodejsRunActionManifest } from "./manifest"

export function createNodejsRunAction(deps: {
  readonly runtime: ScriptRuntimeService
  readonly secrets: Pick<SecretsService, "get">
}): NoAuthorizationMainActionDefinition<NodejsAutomationConfig> {
  return createScriptAutomationAction({
    manifest: nodejsRunActionManifest,
    ...deps,
    run: (runtime, input, { config, context }) => runtime.runNodejs({
        source: config.source,
        input,
        timeoutSeconds: config.timeoutSeconds,
        abortSignal: context.abortSignal,
        cwd: context.cwd,
        moduleMode: config.moduleMode,
      }),
  })
}
