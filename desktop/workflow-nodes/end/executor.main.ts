import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { EndNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"

const logger = createMainLogger("workflow.node.end-executor")

export const endNodeExecutor: NodeExecutor<EndNodeConfig> = {
  async execute(input: NodeExecutionInput<EndNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, context } = input
    logger.info("end node executing", {
      runId: context.runId,
      templateLength: config.template.length,
      variableCount: Object.keys(resolvedVariables).length,
    })
    const output = interpolatePrompt(config.template, resolvedVariables)
    const durationMs = Date.now() - start
    logger.info("end node succeeded", {
      runId: context.runId,
      outputLength: output.length,
      durationMs,
    })
    return { status: "success", output, durationMs }
  },
}
