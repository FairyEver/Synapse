import { executeScriptWorkflowNode } from "../../script-runtime/main/execution-adapters"
import type { JavascriptWorkflowConfig } from "../../script-runtime/shared/schema"
import type { NodeExecutor } from "../../../workflow-nodes/types"

export const javascriptRunNodeExecutor: NodeExecutor<JavascriptWorkflowConfig> = {
  execute(input) {
    return executeScriptWorkflowNode({
      input,
      unavailableMessage: "JavaScript runtime is unavailable.",
      run: (runtime, { config, resolvedInputs, context }) => runtime.runJavascript({
        source: config.source,
        input: resolvedInputs ?? {},
        timeoutSeconds: config.timeoutSeconds,
        abortSignal: context.abortSignal,
      }),
    })
  },
}
