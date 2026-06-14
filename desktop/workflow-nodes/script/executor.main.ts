import type { NodeExecutor, NodeExecutionInput, NodeExecutionResult } from "../types"
import type { ScriptNodeConfig } from "./schema"
import { runShellAction } from "../../action-packages/builtin/shell-process.main"
import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"

const logger = createMainLogger("workflow.node.script-executor")
type ScriptLogContext = ReturnType<typeof workflowNodeLogContext>

export const scriptNodeExecutor: NodeExecutor<ScriptNodeConfig> = {
  async execute(input: NodeExecutionInput<ScriptNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, runtimeDeps, resolvedVariables } = input
    const logContext = workflowNodeLogContext(context)

    if (!runtimeDeps?.processRunner) {
      return { status: "failed", output: "", error: "脚本执行能力不可用", durationMs: Date.now() - start }
    }

    const projectId = context.projectId?.trim()
    if (!projectId) {
      return { status: "failed", output: "", error: "脚本节点缺少项目", durationMs: Date.now() - start }
    }

    const resolveProjectWorkspacePath = runtimeDeps.resolveProjectWorkspacePath
    if (!resolveProjectWorkspacePath) {
      return { status: "failed", output: "", error: "脚本项目路径解析能力不可用", durationMs: Date.now() - start }
    }

    input.onProgress?.("resolving_project", "解析项目…")
    const cwd = await resolveProjectWorkspacePath(projectId)
    if (!cwd) {
      return { status: "failed", output: "", error: "脚本节点项目不存在", durationMs: Date.now() - start }
    }

    input.onProgress?.("preparing", "准备脚本…")
    logger.info("script node executing", {
      ...logContext, shell: config.shell, scriptLength: config.script.length,
    })

    input.onProgress?.("running_script", "执行脚本…")
    try {
      const result = await runShellAction({
        processRunner: runtimeDeps.processRunner,
        content: config.script,
        config: {
          shell: config.shell,
          env: { ...config.env, ...safeResolvedEnv(resolvedVariables, logContext) },
          pathStrategy: config.pathStrategy,
          posixLogin: config.posixLogin,
          timeoutMins: config.timeoutMins,
        },
        context: {
          actor: context.actor ?? { kind: "system" as const, id: "workflow-engine" },
          taskId: context.runId,
          runId: context.runId,
          cwd,
          triggeredBy: "manual",
          abortSignal: context.abortSignal,
        },
        auditSource: "workflow",
        auditActionType: "workflow.script",
      })

      const durationMs = Date.now() - start
      const stdout = (result.outputs?.stdout as string) ?? ""
      const stderr = (result.outputs?.stderr as string) ?? ""
      const exitCode = result.outputs?.exitCode as number | undefined

      input.onProgress?.("processing_output", "处理输出…")

      if (result.status === "success") {
        logger.info("script node succeeded", {
          ...logContext, shell: config.shell,
          exitCode, outputLength: stdout.length, durationMs,
        })
        return {
          status: "success",
          output: stdout,
          outputs: { stdout, stderr, exitCode },
          durationMs,
        }
      }

      const safeResultError = sanitizeError(result.error ?? "")
      logger.warn("script node failed", {
        ...logContext, shell: config.shell,
        exitCode, errorMessage: truncateWithEllipsis(safeResultError, 200), durationMs,
      })
      const errorMsg = result.error
        ? `脚本执行失败：${truncateWithEllipsis(safeResultError, 120)}`
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
        ...logContext, shell: config.shell,
        errorMessage: truncateWithEllipsis(message, 200), durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `脚本执行异常：${truncateWithEllipsis(sanitizeError(message), 120)}`,
        durationMs,
      }
    }
  },
}

const PROTECTED_ENV_NAMES = new Set([
  "PATH",
  "HOME",
  "SHELL",
  "USER",
  "USERNAME",
  "PWD",
  "OLDPWD",
  "TMPDIR",
  "TEMP",
  "TMP",
  "NODE_OPTIONS",
  "NODE_ENV",
])

function safeResolvedEnv(resolvedVariables: Record<string, string>, logContext: ScriptLogContext): Record<string, string> {
  const env: Record<string, string> = {}
  const skipped: string[] = []
  for (const [key, value] of Object.entries(resolvedVariables)) {
    if (PROTECTED_ENV_NAMES.has(key.toUpperCase())) {
      skipped.push(key)
      continue
    }
    env[key] = value
  }
  if (skipped.length > 0) {
    logger.warn("script node skipped protected resolved variable env names", { ...logContext, skipped })
  }
  return env
}
