import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { WorkflowCallNodeConfig } from "./schema"

export const workflowCallNodeExecutor: NodeExecutor<WorkflowCallNodeConfig> = {
  async execute(input: NodeExecutionInput<WorkflowCallNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    return {
      status: "failed",
      output: "",
      error: input.config.workflowId ? "调用工作流能力不可用" : "请选择要调用的工作流",
      durationMs: Date.now() - start,
    }
  },
}
