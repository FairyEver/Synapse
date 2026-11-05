import type { ActionRuntimeContext, MainActionDefinition } from "../../../electron/action-runtime/action-registry"
import { renderActionTemplate } from "../../../electron/action-runtime/template-variables"
import { createMainLogger } from "../../../electron/services/log-store"
import { claudeCodeActionManifest } from "./manifest"
import type { ClaudeCodeActionConfig } from "./schema"

/** Narrow automation boundary: no continuation, model, environment or executable overrides. */
export type LaunchAutomationClaudeCode = (input: {
  readonly projectId: string
  readonly initialPrompt: string
  readonly singleRun?: boolean
  readonly abortSignal: AbortSignal
  readonly actor: ActionRuntimeContext["actor"]
  readonly onCreated: (sessionId: string) => Promise<void>
}) => Promise<{ readonly id: string }>
const logger = createMainLogger("action.claude-code")

export function createClaudeCodeAction(deps: { readonly launch: LaunchAutomationClaudeCode }): MainActionDefinition<ClaudeCodeActionConfig> {
  return {
    manifest: claudeCodeActionManifest,
    buildPermissionRequest: ({ config, context }) => ({
      action: "agent.spawn", actor: context.actor, resource: `claude-code:${config.projectId}`,
      context: { source: "automation", actionType: claudeCodeActionManifest.id, projectId: config.projectId, taskId: context.taskId, runId: context.runId },
    }),
    async execute({ config, context }) {
      const started = Date.now()
      const timeout = AbortSignal.timeout(60_000)
      const signal = AbortSignal.any([context.abortSignal, timeout])
      let outputs: Record<string, unknown> | undefined
      try {
        signal.throwIfAborted()
        const prompt = renderActionTemplate(config.prompt, context.templateVariables)
        if (!prompt.trim()) throw new Error("empty_prompt")
        await deps.launch({
          projectId: config.projectId, initialPrompt: prompt, singleRun: config.singleRun, abortSignal: signal, actor: context.actor,
          onCreated: async sessionId => {
            outputs = { projectId: config.projectId, sessionId }
            if (!context.persistOutputs) throw new Error("run_persistence_unavailable")
            await context.persistOutputs(outputs)
          },
        })
        return {
          status: "success", summary: "已启动 Claude Code 并提交提示词", outputs,
          metrics: { durationMs: Date.now() - started },
        }
      } catch (error) {
        const status = context.abortSignal.aborted ? "cancelled" : timeout.aborted ? "timeout" : "failed"
        logger.warn("Claude Code automation launch did not confirm submission.", {
          taskId: context.taskId, runId: context.runId, projectId: config.projectId, status,
          errorName: error instanceof Error ? error.name : typeof error,
        })
        const message = error instanceof Error && error.message === "empty_prompt"
          ? "展开后的提示词为空，请检查触发变量。"
          : status === "cancelled" ? "已停止等待提示词提交。"
          : status === "timeout" ? "未确认提示词提交，请查看关联终端。"
          : isLaunchError(error) ? error.message : "无法启动 Claude Code 或确认提示词提交，请检查项目与默认供应商配置。"
        return { status, error: message, outputs, metrics: { durationMs: Date.now() - started } }
      }
    },
  }
}

function isLaunchError(error: unknown): error is Error {
  return error instanceof Error && error.name === "ClaudeCodeTerminalError"
}
