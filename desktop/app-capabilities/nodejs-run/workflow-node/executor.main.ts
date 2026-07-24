import { executeScriptWorkflowNode } from "../../script-runtime/main/execution-adapters"
import type { NodejsWorkflowConfig } from "../../script-runtime/shared/schema"
import type { NodeExecutor } from "../../../workflow-nodes/types"

export const nodejsRunNodeExecutor: NodeExecutor<NodejsWorkflowConfig> = {
  execute(input) {
    return executeScriptWorkflowNode({
      input,
      unavailableMessage: "Node.js runtime is unavailable.",
      run: async (runtime, { config, resolvedInputs, context, runtimeDeps }) => {
        const projectWorkingDirectory = context.projectId
          ? await runtimeDeps?.resolveProjectWorkspacePath?.(context.projectId)
          : undefined
        const cwd = config.workingDirectory?.trim()
          || projectWorkingDirectory
          || runtime.defaultWorkingDirectory
        return runtime.runNodejs({
          source: config.source,
          input: resolvedInputs ?? {},
          timeoutSeconds: config.timeoutSeconds,
          abortSignal: context.abortSignal,
          cwd,
          moduleMode: config.moduleMode,
        })
      },
    })
  },
}
