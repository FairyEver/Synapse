import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { sanitizeWorkflowOutputForHistory } from "../../../electron/services/workflow/run-snapshot-sanitize"
import type { ActorIdentity } from "../../../electron/runtime/security"
import type {
  WorkflowDefinition,
  WorkflowRunResult,
} from "../../../src/types/workflow"
import { workflowActionManifest } from "./manifest"
import {
  buildWorkflowRunParams,
  workflowStatusToActionStatus,
  type WorkflowActionConfig,
} from "./schema"

export interface WorkflowActionRuntimeDeps {
  readonly getWorkflowDefinition: (workflowId: string) => Promise<WorkflowDefinition | null>
  readonly runWorkflowAndWait: (input: {
    readonly workflowId: string
    readonly params: Record<string, unknown>
    readonly abortSignal: AbortSignal
    readonly triggerSource: "automation"
    readonly automationId: string
    readonly automationRunId: string
    readonly actor: ActorIdentity
    readonly expectedVersion: string
  }) => Promise<{
    readonly runId: string
    readonly definition: WorkflowDefinition
    readonly result: WorkflowRunResult
  }>
}

export function createWorkflowAction(deps: WorkflowActionRuntimeDeps): MainActionDefinition<WorkflowActionConfig> {
  return {
    manifest: workflowActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "workflow.run",
      actor: context.actor,
      resource: `builtin.workflow:${config.workflowId}`,
      context: {
        source: "automation",
        actionType: workflowActionManifest.id,
        automationId: context.taskId,
        automationRunId: context.runId,
        triggeredBy: context.triggeredBy,
        workflowId: config.workflowId,
      },
    }),
    async execute({ config, context }) {
      const definition = await deps.getWorkflowDefinition(config.workflowId)
      if (!definition) {
        return {
          status: "failed",
          summary: "执行失败",
          error: "工作流不存在",
        }
      }

      try {
        const params = buildWorkflowRunParams({
          workflowParams: definition.params,
          paramTemplates: config.paramTemplates,
          templateVariables: context.templateVariables ?? {},
        })
        const run = await deps.runWorkflowAndWait({
          workflowId: definition.id,
          params,
          abortSignal: context.abortSignal,
          triggerSource: "automation",
          automationId: context.taskId,
          automationRunId: context.runId,
          actor: context.actor,
          expectedVersion: definition.version,
        })
        const status = workflowStatusToActionStatus(run.result.status)
        const label = status === "success" ? "完成" : status === "cancelled" ? "已停止" : "失败"

        return {
          status,
          summary: `工作流${label}：${run.definition.name}`,
          metrics: { durationMs: run.result.durationMs },
          outputs: {
            workflowId: run.definition.id,
            workflowName: run.definition.name,
            workflowRunId: run.runId,
            workflowStatus: run.result.status,
            output: sanitizeWorkflowOutputForHistory(run.result.output),
          },
          error: status === "failed" ? "工作流执行失败" : undefined,
        }
      } catch (error) {
        const status = context.abortSignal.aborted ? "cancelled" : "failed"
        const message = error instanceof Error ? error.message : String(error)
        return {
          status,
          summary: status === "cancelled" ? `工作流已停止：${definition.name}` : "执行失败",
          error: status === "cancelled" ? "已停止" : message,
        }
      }
    },
  }
}
