import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { createMainLogger } from "../../electron/services/log-store"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../types"
import type { TextNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.text-executor")

export const textNodeExecutor: NodeExecutor<TextNodeConfig> = {
  async execute(input: NodeExecutionInput<TextNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, resolvedVariables, context } = input
    logger.info("text node executing", {
      runId: context.runId,
      templateLength: config.template.length,
      variableCount: Object.keys(resolvedVariables).length,
    })

    let output: string
    try {
      output = interpolatePrompt(config.template, resolvedVariables)
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: `模板变量解析失败：${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      }
    }

    const durationMs = Date.now() - start
    logger.info("text node succeeded", {
      runId: context.runId,
      outputLength: output.length,
      durationMs,
    })
    return { status: "success", output, durationMs }
  },
}
