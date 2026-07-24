import type { NoAuthorizationMainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { SecretsService } from "../../secrets/main/service"
import { createScriptAutomationAction } from "../../script-runtime/main/execution-adapters"
import type { ScriptRuntimeService } from "../../script-runtime/main/service"
import type { JavascriptAutomationConfig } from "../../script-runtime/shared/schema"
import { javascriptRunActionManifest } from "./manifest"

export function createJavascriptRunAction(deps: {
  readonly runtime: ScriptRuntimeService
  readonly secrets: Pick<SecretsService, "get">
}): NoAuthorizationMainActionDefinition<JavascriptAutomationConfig> {
  return createScriptAutomationAction({
    manifest: javascriptRunActionManifest,
    ...deps,
    run: (runtime, input, { config, context }) => runtime.runJavascript({
        source: config.source,
        input,
        timeoutSeconds: config.timeoutSeconds,
        abortSignal: context.abortSignal,
      }),
  })
}
