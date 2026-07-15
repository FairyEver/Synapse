import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult, WorkflowCallStackEntry } from "../types"
import type { WorkflowRunResult } from "../../src/types/workflow"
import { createMainLogger } from "../../electron/services/log-store"
import { workflowNodeLogContext } from "../log-context"
import { buildWorkflowCallParams } from "./params"
import type { WorkflowCallNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.workflow-call-executor")
const MAX_WORKFLOW_CALL_DEPTH = 5

export const workflowCallNodeExecutor: NodeExecutor<WorkflowCallNodeConfig> = {
  async execute(input: NodeExecutionInput<WorkflowCallNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps, resolvedVariables } = input
    const workflowCall = runtimeDeps?.workflowCall
    const logContext = workflowNodeLogContext(context)

    if (!workflowCall) {
      return { status: "failed", output: "", error: "调用工作流能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("loading_workflow", "加载子工作流…")
    const childDefinition = await workflowCall.getWorkflowDefinition(config.workflowId)
    if (!childDefinition) {
      return { status: "failed", output: "", error: "子工作流不存在", durationMs: Date.now() - start }
    }

    const parentStack = normalizeCallStack(context)
    if (parentStack.some((entry) => entry.workflowId === childDefinition.id)) {
      const chain = formatCallChain([...parentStack, { workflowId: childDefinition.id, workflowName: childDefinition.name }])
      return { status: "failed", output: "", error: `调用链包含循环：${chain}`, durationMs: Date.now() - start }
    }
    if (parentStack.length >= MAX_WORKFLOW_CALL_DEPTH) {
      return { status: "failed", output: "", error: "工作流嵌套层级超过 5", durationMs: Date.now() - start }
    }

    input.onProgress?.("building_params", "构建参数…")
    const paramResult = buildWorkflowCallParams({
      childDefinition,
      paramTemplates: config.paramTemplates,
      paramBindings: config.paramBindings,
      parentParamValues: input.paramValues,
      parentParamDefinitions: input.paramDefinitions,
      resolvedVariables,
    })
    if (paramResult.errors.length > 0) {
      return { status: "failed", output: "", error: paramResult.errors[0], durationMs: Date.now() - start }
    }

    const nextStack = [...parentStack, { workflowId: childDefinition.id, workflowName: childDefinition.name }]
    const childProjectId = childDefinition.defaultProjectId?.trim() || context.projectId
    logger.info("workflow call node executing", {
      ...logContext,
      childWorkflowId: childDefinition.id,
      childWorkflowName: childDefinition.name,
      paramKeys: Object.keys(paramResult.params),
      paramCount: Object.keys(paramResult.params).length,
      depth: nextStack.length,
    })

    input.onProgress?.("running_child_workflow", "运行子工作流…")
    const childRun = await workflowCall.runWorkflow({
      definition: childDefinition,
      params: paramResult.params,
      projectId: childProjectId,
      triggerSource: "workflow-call",
      abortSignal: context.abortSignal,
      actor: context.actor,
      automationId: context.automationId,
      automationRunId: context.automationRunId,
      parentWorkflowId: context.workflowId,
      parentRunId: context.runId,
      parentNodeId: context.nodeId,
      parentNodeName: context.nodeName,
      callStack: nextStack,
    })

    const durationMs = Date.now() - start
    const outputs = {
      childWorkflowId: childDefinition.id,
      childWorkflowName: childDefinition.name,
      childRunId: childRun.runId,
      childStatus: childRun.result.status,
    }

    if (childRun.result.status === "cancelled") {
      return { status: "cancelled", output: "", outputs, error: "子工作流已取消", durationMs }
    }
    if (childRun.result.status === "failed") {
      return { status: "failed", output: childRun.result.output ?? "", outputs, error: childFailureMessage(childRun.result), durationMs }
    }

    return { status: "success", output: childRun.result.output ?? "", outputs, durationMs }
  },
}

function childFailureMessage(result: WorkflowRunResult): string {
  const runError = (result as WorkflowRunResult & { error?: unknown }).error
  if (typeof runError === "string" && runError.trim().length > 0) {
    return `子工作流执行失败：${runError.trim()}`
  }
  const failedNodeError = Object.values(result.nodeResults)
    .find((nodeResult) => nodeResult.status === "failed" && typeof nodeResult.error === "string" && nodeResult.error.trim().length > 0)
    ?.error
    ?.trim()
  return failedNodeError ? `子工作流执行失败：${failedNodeError}` : "子工作流执行失败"
}

function normalizeCallStack(context: NodeExecutionInput<WorkflowCallNodeConfig>["context"]): readonly WorkflowCallStackEntry[] {
  if (context.workflowCallStack && context.workflowCallStack.length > 0) return context.workflowCallStack
  return context.workflowId ? [{ workflowId: context.workflowId, workflowName: context.workflowName }] : []
}

function formatCallChain(stack: readonly WorkflowCallStackEntry[]): string {
  return stack.map((entry) => entry.workflowName || entry.workflowId).join(" -> ")
}
