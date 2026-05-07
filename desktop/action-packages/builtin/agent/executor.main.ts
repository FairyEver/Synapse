import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { AgentRuntimeService } from "../../../electron/services/agent-runtime/agent-runtime-service"
import { agentActionManifest } from "./manifest"
import type { AgentActionConfig } from "./schema"

export function createAgentAction(deps: {
  readonly getAgentRuntime: (projectId: string) => AgentRuntimeService | undefined
}): MainActionDefinition<AgentActionConfig> {
  return {
    manifest: agentActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.spawn",
      actor: context.actor,
      resource: `${config.agentType}:${config.mode}`,
      context: {
        source: "task-scheduler",
        actionType: agentActionManifest.id,
        taskId: context.taskId,
        runId: context.runId,
        triggeredBy: context.triggeredBy,
        projectId: config.projectId,
        agentType: config.agentType,
        mode: config.mode,
        sessionPolicy: config.sessionPolicy,
      },
    }),
    async execute(input) {
      const runtime = deps.getAgentRuntime(input.config.projectId)
      if (!runtime) {
        return {
          status: "failed",
          error: `No agent runtime found for project "${input.config.projectId}"`,
          metrics: { durationMs: 0 },
        }
      }

      const lastConversationId = typeof input.previousOutputs?.conversationId === "string"
        ? input.previousOutputs.conversationId
        : undefined

      const result = await runtime.sendScheduled({
        projectId: input.config.projectId,
        agentType: input.config.agentType,
        mode: input.config.mode,
        prompt: input.config.prompt,
        sessionPolicy: input.config.sessionPolicy,
        timeoutMs: (input.config.timeoutMins ?? 30) * 60_000,
        lastConversationId,
        abortSignal: input.context.abortSignal,
      })

      return {
        status: result.status === "success" ? "success" : "failed",
        summary: result.summary,
        error: result.error,
        outputs: { conversationId: result.conversationId },
        metrics: { durationMs: result.durationMs },
      }
    },
  }
}
