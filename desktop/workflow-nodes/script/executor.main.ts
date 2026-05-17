import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { ScriptNodeConfig } from "./schema"
import { runShellAction } from "../../action-packages/builtin/shell-process.main"
import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError } from "../../electron/services/error-sanitize"

const logger = createMainLogger("workflow.node.script-executor")

export const scriptNodeExecutor: NodeExecutor<ScriptNodeConfig> = {
  async execute(input: NodeExecutionInput<ScriptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps, resolvedVariables } = input

    if (!runtimeDeps?.processRunner) {
      return { status: "failed", output: "", error: "脚本执行能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("preparing", "准备脚本…")
    logger.info("script node executing", {
      runId: context.runId, shell: config.shell, scriptLength: config.script.length,
    })

    input.onProgress?.("running_script", "执行脚本…")
    try {
      const result = await runShellAction({
        processRunner: runtimeDeps.processRunner,
        content: config.script,
        config: {
          shell: config.shell,
          env: { ...config.env, ...resolvedVariables },
          pathStrategy: config.pathStrategy,
          posixLogin: config.posixLogin,
          timeoutMins: config.timeoutMins,
        },
        context: {
          actor: { kind: "system" as const, id: "workflow-engine" },
          taskId: context.runId,
          runId: context.runId,
          cwd: process.cwd(),
          triggeredBy: "manual",
          abortSignal: context.abortSignal,
        },
      })

      const durationMs = Date.now() - start
      const stdout = (result.outputs?.stdout as string) ?? ""
      const stderr = (result.outputs?.stderr as string) ?? ""
      const exitCode = result.outputs?.exitCode as number | undefined

      input.onProgress?.("processing_output", "处理输出…")

      if (result.status === "success") {
        logger.info("script node succeeded", {
          runId: context.runId, shell: config.shell,
          exitCode, outputLength: stdout.length, durationMs,
        })
        return {
          status: "success",
          output: stdout,
          outputs: { stdout, stderr, exitCode },
          durationMs,
        }
      }

      logger.warn("script node failed", {
        runId: context.runId, shell: config.shell,
        exitCode, errorMessage: (result.error ?? "").slice(0, 200), durationMs,
      })
      const errorMsg = result.error
        ? `脚本执行失败：${result.error.length <= 120 ? result.error : result.error.slice(0, 120) + "..."}`
        : `脚本退出码 ${String(exitCode)}`
      return {
        status: "failed",
        output: stdout,
        outputs: { stdout, stderr, exitCode },
        error: errorMsg,
        durationMs,
      }
    } catch (err) {
      const durationMs = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      logger.warn("script node threw exception", {
        runId: context.runId, shell: config.shell,
        errorMessage: message.slice(0, 200), durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `脚本执行异常：${sanitizeError(message.length <= 120 ? message : message.slice(0, 120) + "...")}`,
        durationMs,
      }
    }
  },
}
