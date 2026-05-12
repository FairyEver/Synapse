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
      templatePreview: config.template.slice(0, 200),
      variableCount: Object.keys(resolvedVariables).length,
    })
    const output = interpolatePrompt(config.template, resolvedVariables)
    const durationMs = Date.now() - start
    logger.info("end node succeeded", {
      runId: context.runId,
      outputPreview: output.slice(0, 200),
      durationMs,
    })
    return { status: "success", output, durationMs }
  },
}
