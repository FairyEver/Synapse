import { app } from "electron"

import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../types"
import {
  buildCodexDebugOutput,
  codexArtifactPaths,
  ensureCodexArtifactDirectory,
  finalOutputFromResult,
  readCodexArtifact,
  writeCodexArtifact,
  type CodexNodeDebugOutput,
} from "./artifacts.main"
import { buildCodexExecRequest } from "./command"
import type { CodexNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.codex-executor")

export const codexNodeExecutor: NodeExecutor<CodexNodeConfig> = {
  async execute(input: NodeExecutionInput<CodexNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, resolvedVariables, runtimeDeps } = input
    const logContext = workflowNodeLogContext(context)
    const processRunner = runtimeDeps?.processRunner

    if (!processRunner) {
      return {
        status: "failed",
        output: "",
        error: "Codex 执行能力不可用",
        durationMs: Date.now() - start,
      }
    }

    const projectId = config.projectId?.trim() || context.projectId?.trim()
    if (!projectId) {
      return {
        status: "failed",
        output: "",
        error: "Codex 节点缺少项目",
        durationMs: Date.now() - start,
      }
    }

    const resolveProjectWorkspacePath = runtimeDeps?.resolveProjectWorkspacePath
    if (!resolveProjectWorkspacePath) {
      return {
        status: "failed",
        output: "",
        error: "Codex 项目路径解析能力不可用",
        durationMs: Date.now() - start,
      }
    }

    input.onProgress?.("resolving_project", "解析项目…")
    const cwd = await resolveProjectWorkspacePath(projectId)
    if (!cwd) {
      return {
        status: "failed",
        output: "",
        error: "Codex 节点项目不存在",
        durationMs: Date.now() - start,
      }
    }

    input.onProgress?.("resolving_variables", "解析变量…")
    let prompt: string
    try {
      prompt = interpolatePrompt(config.prompt, resolvedVariables)
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: `模板变量解析失败：${error instanceof Error ? error.message : String(error)}`,
        durationMs: Date.now() - start,
      }
    }

    const actor = context.actor ?? { kind: "system" as const, id: "workflow-engine" }
    const timeoutMs = config.timeoutMins === undefined ? undefined : config.timeoutMins * 60_000
    const artifactPaths = codexArtifactPaths(
      app.getPath("userData"),
      context.runId,
      context.nodeId ?? "unknown-node",
    )

    await bestEffortArtifactWrite({
      logContext,
      label: "artifact directory",
      task: () => ensureCodexArtifactDirectory(artifactPaths),
    })
    await bestEffortArtifactWrite({
      logContext,
      label: "prompt artifact",
      filePath: artifactPaths.promptPath,
      task: () => writeCodexArtifact(artifactPaths.promptPath, prompt),
    })

    const request = buildCodexExecRequest({
      config,
      prompt,
      cwd,
      lastMessagePath: artifactPaths.lastMessagePath,
      actor,
      timeoutMs,
      abortSignal: context.abortSignal,
      metadata: {
        source: "workflow",
        actionType: "workflow.codex",
        workflowId: context.workflowId,
        workflowRunId: context.runId,
        workflowNodeId: context.nodeId,
        workflowNodeName: context.nodeName,
      },
    })

    logger.info("codex node executing", {
      ...logContext,
      projectId,
      cwd,
      promptLength: prompt.length,
      timeoutMs,
    })

    input.onProgress?.("running_codex", "执行 Codex…")
    try {
      const result = await processRunner.run(request)
      const durationMs = Date.now() - start
      const stdout = result.stdout ?? ""
      const stderr = result.stderr ?? ""

      await bestEffortArtifactWrite({
        logContext,
        label: "stdout artifact",
        filePath: artifactPaths.stdoutPath,
        task: () => writeCodexArtifact(artifactPaths.stdoutPath, stdout),
      })
      await bestEffortArtifactWrite({
        logContext,
        label: "stderr artifact",
        filePath: artifactPaths.stderrPath,
        task: () => writeCodexArtifact(artifactPaths.stderrPath, stderr),
      })

      const lastMessage = await bestEffortReadArtifact(artifactPaths.lastMessagePath, logContext)
      const output = finalOutputFromResult(lastMessage, stdout)
      const codexDebug = buildCodexDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: result.exitCode,
        signal: result.signal ?? undefined,
        durationMs: result.durationMs,
        stdoutPath: artifactPaths.stdoutPath,
        stderrPath: artifactPaths.stderrPath,
        promptPath: artifactPaths.promptPath,
        lastMessagePath: artifactPaths.lastMessagePath,
        stdout,
        stderr,
      })
      const outputs = { codexDebug }

      if (context.abortSignal.aborted) {
        logger.warn("codex node cancelled", {
          ...logContext,
          projectId,
          cwd,
          durationMs,
        })
        return {
          status: "cancelled",
          output,
          outputs,
          error: "运行被取消",
          durationMs,
        }
      }

      if (result.timedOut) {
        logger.warn("codex node timed out", {
          ...logContext,
          projectId,
          cwd,
          durationMs,
        })
        return {
          status: "failed",
          output,
          outputs,
          error: "Codex 执行超时",
          durationMs,
        }
      }

      if (result.error || result.exitCode !== 0) {
        const error = failureMessageFromResult(result)
        logger.warn("codex node failed", {
          ...logContext,
          projectId,
          cwd,
          exitCode: result.exitCode,
          signal: result.signal ?? undefined,
          errorMessage: error,
          durationMs,
        })
        return {
          status: "failed",
          output,
          outputs,
          error,
          durationMs,
        }
      }

      input.onProgress?.("processing_output", "处理输出…")
      logger.info("codex node succeeded", {
        ...logContext,
        projectId,
        cwd,
        outputLength: output.length,
        durationMs,
      })
      return {
        status: "success",
        output,
        outputs,
        durationMs,
      }
    } catch (error) {
      const durationMs = Date.now() - start
      if (context.abortSignal.aborted) {
        return {
          status: "cancelled",
          output: "",
          error: "运行被取消",
          durationMs,
        }
      }

      const rawMessage = error instanceof Error ? error.message : String(error)
      const sanitized = truncateWithEllipsis(sanitizeError(rawMessage), 120)
      logger.warn("codex node threw exception", {
        ...logContext,
        projectId,
        cwd,
        errorMessage: sanitized,
        durationMs,
      })
      return {
        status: "failed",
        output: "",
        error: `Codex 执行异常：${sanitized}`,
        durationMs,
      }
    }
  },
}

function failureMessageFromResult(result: {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stderr?: string
  readonly error?: string
}): string {
  const candidate = result.error?.trim()
    || result.stderr?.trim()
    || (result.signal ? `Codex 被信号 ${result.signal} 终止` : undefined)
    || (result.exitCode !== null ? `Codex 退出码 ${String(result.exitCode)}` : "Codex 执行失败")

  return `Codex 执行失败：${truncateWithEllipsis(sanitizeError(candidate), 120)}`
}

async function bestEffortReadArtifact(
  filePath: string,
  logContext: ReturnType<typeof workflowNodeLogContext>,
): Promise<string | undefined> {
  try {
    return await readCodexArtifact(filePath)
  } catch (error) {
    warnArtifactFailure({
      logContext,
      label: "last message artifact",
      filePath,
      error,
    })
    return undefined
  }
}

async function bestEffortArtifactWrite(input: {
  readonly logContext: ReturnType<typeof workflowNodeLogContext>
  readonly label: string
  readonly filePath?: string
  readonly task: () => Promise<void>
}): Promise<void> {
  try {
    await input.task()
  } catch (error) {
    warnArtifactFailure({
      logContext: input.logContext,
      label: input.label,
      filePath: input.filePath,
      error,
    })
  }
}

function warnArtifactFailure(input: {
  readonly logContext: ReturnType<typeof workflowNodeLogContext>
  readonly label: string
  readonly filePath?: string
  readonly error: unknown
}): void {
  logger.warn("codex node artifact I/O failed", {
    ...input.logContext,
    artifact: input.label,
    filePath: input.filePath,
    errorMessage: truncateWithEllipsis(
      sanitizeError(input.error instanceof Error ? input.error.message : String(input.error)),
      200,
    ),
  })
}

export type { CodexNodeDebugOutput }
