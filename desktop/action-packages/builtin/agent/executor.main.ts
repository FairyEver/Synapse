import type { MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import type { AgentRuntimeService } from "../../../electron/services/agent-runtime/agent-runtime-service"
import { sanitizeError } from "../../../electron/services/error-sanitize"
import { createMainLogger } from "../../../electron/services/log-store"
import { agentActionManifest } from "./manifest"
import type { AgentActionConfig } from "./schema"

const logger = createMainLogger("action.agent-executor")

export function createAgentAction(deps: {
  readonly getAgentRuntime: (projectId: string) => Promise<AgentRuntimeService | undefined>
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
      const startMs = Date.now()
      const runtime = await deps.getAgentRuntime(input.config.projectId)
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

      const currentConfigVersion = input.context.configVersion ?? 0
      const previousConfigVersion = typeof input.previousOutputs?.configVersion === "number"
        ? input.previousOutputs.configVersion
        : undefined
      const configChanged = previousConfigVersion !== undefined
        && previousConfigVersion !== currentConfigVersion
      const userMeta: Record<string, unknown> = {
        source: "scheduled",
        taskId: input.context.taskId,
        taskRunId: input.context.runId,
      }
      if (input.context.taskName) userMeta.taskName = input.context.taskName

      try {
        const result = await runtime.sendScheduled({
          projectId: input.config.projectId,
          agentType: input.config.agentType,
          mode: input.config.mode,
          prompt: input.config.prompt,
          sessionPolicy: input.config.sessionPolicy,
          timeoutMs: scheduledTimeoutMs(input.config.timeoutMins),
          lastConversationId: configChanged ? undefined : lastConversationId,
          abortSignal: input.context.abortSignal,
          providerId: input.config.providerId,
          modelTier: input.config.modelTier,
          userMeta,
        })
        const status = result.status === "error"
          ? input.context.abortSignal.aborted ? "cancelled" : "failed"
          : result.status

        return {
          status,
          summary: result.summary,
          error: persistableAgentError(status, result.error),
          outputs: {
            conversationId: result.conversationId,
            projectId: input.config.projectId,
            platform: "scheduled",
            ...(result.sessionKey ? { sessionKey: result.sessionKey } : {}),
            configVersion: currentConfigVersion,
          },
          metrics: { durationMs: result.durationMs },
          usage: result.usage,
          costUsd: result.costUsd,
          costCny: result.costCny,
          costCurrency: result.costCurrency,
        }
      } catch (rawError) {
        const message = rawError instanceof Error ? rawError.message : String(rawError)
        logger.error("Agent action execute failed.", {
          taskId: input.context.taskId,
          runId: input.context.runId,
          projectId: input.config.projectId,
          agentType: input.config.agentType,
          error: sanitizeError(message),
        })
        const isProviderError = message.includes("Provider not found")
        const sanitized = sanitizeError(message)
        const truncated = sanitized.length > 120 ? sanitized.slice(0, 120) + "…" : sanitized
        return {
          status: "failed",
          error: isProviderError
            ? "供应商已删除或不可用，请重新配置"
            : `Agent runtime error: ${truncated}`,
          metrics: { durationMs: Date.now() - startMs },
        }
      }
    },
  }
}

function persistableAgentError(
  status: "success" | "failed" | "timeout" | "cancelled",
  error: string | undefined,
): string | undefined {
  if (!error) return undefined
  if (status !== "failed") return error
  const sanitized = sanitizeError(error)
  const truncated = sanitized.length > 120 ? sanitized.slice(0, 120) + "…" : sanitized
  return `Agent runtime error: ${truncated}`
}

function scheduledTimeoutMs(timeoutMins: number | null | undefined): number | undefined {
  if (timeoutMins === null) return undefined
  return (timeoutMins ?? 60) * 60_000
}
