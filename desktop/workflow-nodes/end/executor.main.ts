import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { EndNodeConfig } from "./schema"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"

export const endNodeExecutor: NodeExecutor<EndNodeConfig> = {
  async execute(input: NodeExecutionInput<EndNodeConfig>): Promise<NodeExecutionResult> {
    const output = interpolatePrompt(input.config.template, input.resolvedVariables)
    return { status: "success", output, durationMs: 0 }
  },
}
