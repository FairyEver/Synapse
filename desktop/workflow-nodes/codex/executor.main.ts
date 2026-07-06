import { appendFile, mkdtemp, rm, stat } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { app } from "electron"

import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError } from "../../electron/services/error-sanitize"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"
import { createWorkflowExternalPathResources } from "../path-resource-metadata"
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
const CODEX_STREAM_PREVIEW_MAX_CHARS = 64 * 1024
const CODEX_STREAM_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024
const CODEX_STREAM_TRUNCATED_NOTICE = "\n[truncated: codex output exceeded artifact limit]\n"
const MISSING_CODEX_CLI_ERROR = "未找到 Codex CLI"

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
    const projectWorkspacePath = await resolveProjectWorkspacePath(projectId)
    if (!projectWorkspacePath) {
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

    let cwd: string
    try {
      cwd = await resolveCodexWorkingDirectory({
        projectWorkspacePath,
        workingDirectory: config.workingDirectory,
        resolvedVariables,
      })
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      }
    }

    let resolvedPathConfig: Pick<CodexNodeConfig, "additionalWritableDirs" | "images">
    try {
      resolvedPathConfig = await resolveCodexAdvancedPaths({
        cwd,
        additionalWritableDirs: config.additionalWritableDirs,
        images: config.images,
        resolvedVariables,
      })
    } catch (error) {
      return {
        status: "failed",
        output: "",
        error: error instanceof Error ? error.message : String(error),
        durationMs: Date.now() - start,
      }
    }
    const requestConfig: CodexNodeConfig = { ...config, ...resolvedPathConfig }
    const externalPathResources = createWorkflowExternalPathResources([
      ...requestConfig.additionalWritableDirs.map((resolvedPath) => ({
        source: "codex.additionalWritableDirs",
        path: resolvedPath,
        cwd,
        kind: "directory" as const,
        access: "read_write" as const,
      })),
      ...requestConfig.images.map((resolvedPath) => ({
        source: "codex.images",
        path: resolvedPath,
        cwd,
        kind: "file" as const,
        access: "read" as const,
      })),
    ])

    const actor = context.actor ?? { kind: "system" as const, id: "workflow-engine" }
    const timeoutMs = config.timeoutMins === undefined ? undefined : config.timeoutMins * 60_000
    const captureDebugArtifacts = config.captureDebugArtifacts
    const artifactPaths = codexArtifactPaths(
      app.getPath("userData"),
      context.runId,
      context.nodeId ?? "unknown-node",
    )
    let lastMessageTarget: CodexLastMessageTarget
    try {
      lastMessageTarget = await prepareCodexLastMessageTarget({
        captureDebugArtifacts,
        artifactPaths,
      })
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : String(error)
      const sanitized = truncateWithEllipsis(sanitizeError(rawMessage), 120)
      logger.warn("codex node temporary output path failed", {
        ...logContext,
        projectId,
        cwd,
        errorMessage: sanitized,
      })
      return {
        status: "failed",
        output: "",
        error: `Codex 临时输出文件创建失败：${sanitized}`,
        durationMs: Date.now() - start,
      }
    }

    if (captureDebugArtifacts) {
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
      await bestEffortArtifactWrite({
        logContext,
        label: "stdout artifact",
        filePath: artifactPaths.stdoutPath,
        task: () => writeCodexArtifact(artifactPaths.stdoutPath, ""),
      })
      await bestEffortArtifactWrite({
        logContext,
        label: "stderr artifact",
        filePath: artifactPaths.stderrPath,
        task: () => writeCodexArtifact(artifactPaths.stderrPath, ""),
      })
    }
    const stdoutCapture = new CodexStreamCapture({
      logContext,
      label: "stdout artifact",
      filePath: captureDebugArtifacts ? artifactPaths.stdoutPath : undefined,
    })
    const stderrCapture = new CodexStreamCapture({
      logContext,
      label: "stderr artifact",
      filePath: captureDebugArtifacts ? artifactPaths.stderrPath : undefined,
    })

    const request = buildCodexExecRequest({
      config: requestConfig,
      prompt,
      cwd,
      lastMessagePath: lastMessageTarget.path,
      actor,
      timeoutMs,
      abortSignal: context.abortSignal,
      onStdoutLine: stdoutCapture.handleLine,
      onStderrLine: stderrCapture.handleLine,
      metadata: {
        source: "workflow",
        actionType: "workflow.codex",
        workflowId: context.workflowId,
        workflowRunId: context.runId,
        workflowNodeId: context.nodeId,
        workflowNodeName: context.nodeName,
        ...(context.automationId ? { automationId: context.automationId } : {}),
        ...(context.automationRunId ? { automationRunId: context.automationRunId } : {}),
        ...(externalPathResources.length > 0 ? { externalPathResources } : {}),
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
      await Promise.all([
        stdoutCapture.waitForArtifactWrites(),
        stderrCapture.waitForArtifactWrites(),
      ])
      const durationMs = Date.now() - start
      const stdout = result.stdout ?? stdoutCapture.text()
      const stderr = result.stderr ?? stderrCapture.text()

      let codexDebug = buildCodexDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: result.exitCode,
        signal: result.signal ?? undefined,
        durationMs: result.durationMs,
        ...(captureDebugArtifacts
          ? {
              stdoutPath: artifactPaths.stdoutPath,
              stderrPath: artifactPaths.stderrPath,
              promptPath: artifactPaths.promptPath,
            }
          : {}),
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
          output: "",
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
          output: "",
          outputs,
          error: "Codex 执行超时",
          durationMs,
        }
      }

      if (result.error || result.exitCode !== 0) {
        const error = failureMessageFromResult({ ...result, stdout, stderr })
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
          output: "",
          outputs,
          error,
          durationMs,
        }
      }

      const lastMessage = await bestEffortReadArtifact(lastMessageTarget.path, logContext)
      if (captureDebugArtifacts && lastMessage !== undefined) {
        const lastMessageWritten = await bestEffortArtifactWrite({
          logContext,
          label: "last message artifact",
          filePath: artifactPaths.lastMessagePath,
          task: () => writeCodexArtifact(artifactPaths.lastMessagePath, lastMessage),
        })
        if (lastMessageWritten) {
          codexDebug = buildCodexDebugOutput({
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
          outputs.codexDebug = codexDebug
        }
      }
      const output = finalOutputFromResult(lastMessage, stdout)
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
      await Promise.all([
        stdoutCapture.waitForArtifactWrites(),
        stderrCapture.waitForArtifactWrites(),
      ])
      const durationMs = Date.now() - start
      const stdout = stdoutCapture.text()
      const stderr = stderrCapture.text()
      const codexDebug = buildCodexDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: null,
        durationMs,
        ...(captureDebugArtifacts
          ? {
              stdoutPath: artifactPaths.stdoutPath,
              stderrPath: artifactPaths.stderrPath,
              promptPath: artifactPaths.promptPath,
            }
          : {}),
        stdout,
        stderr,
      })
      const outputs = { codexDebug }

      if (context.abortSignal.aborted) {
        return {
          status: "cancelled",
          output: "",
          outputs,
          error: "运行被取消",
          durationMs,
        }
      }

      const rawMessage = error instanceof Error ? error.message : String(error)
      const sanitized = truncateWithEllipsis(sanitizeError(rawMessage), 120)
      const visibleError = isMissingCodexCliError(error)
        ? MISSING_CODEX_CLI_ERROR
        : `Codex 执行异常：${sanitized}`
      logger.warn("codex node threw exception", {
        ...logContext,
        projectId,
        cwd,
        errorMessage: visibleError,
        durationMs,
      })
      return {
        status: "failed",
        output: "",
        outputs,
        error: visibleError,
        durationMs,
      }
    } finally {
      await cleanupCodexLastMessageTarget(lastMessageTarget, logContext)
    }
  },
}

interface CodexLastMessageTarget {
  readonly path: string
  readonly debugPath?: string
  readonly cleanupDirectory?: string
}

async function prepareCodexLastMessageTarget(input: {
  readonly captureDebugArtifacts: boolean
  readonly artifactPaths: ReturnType<typeof codexArtifactPaths>
}): Promise<CodexLastMessageTarget> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "synapse-codex-last-message-"))
  if (input.captureDebugArtifacts) {
    return {
      path: path.join(directory, "last-message.txt"),
      debugPath: input.artifactPaths.lastMessagePath,
      cleanupDirectory: directory,
    }
  }

  return {
    path: path.join(directory, "last-message.txt"),
    cleanupDirectory: directory,
  }
}

async function cleanupCodexLastMessageTarget(
  target: CodexLastMessageTarget,
  logContext: ReturnType<typeof workflowNodeLogContext>,
): Promise<void> {
  if (!target.cleanupDirectory) return
  try {
    await rm(target.cleanupDirectory, { recursive: true, force: true })
  } catch (error) {
    warnArtifactFailure({
      logContext,
      label: "last message temporary file",
      filePath: target.cleanupDirectory,
      error,
    })
  }
}

async function resolveCodexWorkingDirectory(input: {
  readonly projectWorkspacePath: string
  readonly workingDirectory?: string
  readonly resolvedVariables: Record<string, string>
}): Promise<string> {
  const template = input.workingDirectory?.trim()
  const rendered = template
    ? interpolatePrompt(template, input.resolvedVariables).trim()
    : input.projectWorkspacePath
  if (!rendered) {
    throw new Error("Codex 工作目录不能为空")
  }

  const cwd = path.isAbsolute(rendered)
    ? path.resolve(rendered)
    : path.resolve(input.projectWorkspacePath, rendered)
  let stats
  try {
    stats = await stat(cwd)
  } catch {
    throw new Error("Codex 工作目录不存在")
  }
  if (!stats.isDirectory()) {
    throw new Error("Codex 工作目录不是文件夹")
  }
  return cwd
}

async function resolveCodexAdvancedPaths(input: {
  readonly cwd: string
  readonly additionalWritableDirs: readonly string[]
  readonly images: readonly string[]
  readonly resolvedVariables: Record<string, string>
}): Promise<Pick<CodexNodeConfig, "additionalWritableDirs" | "images">> {
  return {
    additionalWritableDirs: await resolveCodexPathList({
      basePath: input.cwd,
      values: input.additionalWritableDirs,
      resolvedVariables: input.resolvedVariables,
      label: "Codex 可写目录",
      expectedType: "directory",
    }),
    images: await resolveCodexPathList({
      basePath: input.cwd,
      values: input.images,
      resolvedVariables: input.resolvedVariables,
      label: "Codex 图片路径",
      expectedType: "file",
    }),
  }
}

async function resolveCodexPathList(input: {
  readonly basePath: string
  readonly values: readonly string[]
  readonly resolvedVariables: Record<string, string>
  readonly label: string
  readonly expectedType: "directory" | "file"
}): Promise<string[]> {
  const resolved: string[] = []
  for (const value of input.values) {
    let rendered: string
    try {
      rendered = interpolatePrompt(value, input.resolvedVariables).trim()
    } catch (error) {
      throw new Error(`${input.label}变量解析失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (!rendered) {
      throw new Error(`${input.label}不能为空`)
    }
    const absolutePath = path.isAbsolute(rendered)
      ? path.resolve(rendered)
      : path.resolve(input.basePath, rendered)
    let stats
    try {
      stats = await stat(absolutePath)
    } catch {
      throw new Error(`${input.label}不存在`)
    }
    if (input.expectedType === "directory" && !stats.isDirectory()) {
      throw new Error(`${input.label}不是文件夹`)
    }
    if (input.expectedType === "file" && !stats.isFile()) {
      throw new Error(`${input.label}不是文件`)
    }
    resolved.push(absolutePath)
  }
  return resolved
}

function failureMessageFromResult(result: {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout?: string
  readonly stderr?: string
  readonly error?: string
}): string {
  if (isMissingCodexCliError(result.error)) {
    return MISSING_CODEX_CLI_ERROR
  }

  const candidate = result.error?.trim()
    || result.stderr?.trim()
    || result.stdout?.trim()
    || (result.signal ? `Codex 被信号 ${result.signal} 终止` : undefined)
    || (result.exitCode !== null ? `Codex 退出码 ${String(result.exitCode)}` : "Codex 执行失败")

  return `Codex 执行失败：${truncateWithEllipsis(sanitizeError(candidate), 120)}`
}

function isMissingCodexCliError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code).toUpperCase()
    : undefined
  if (code === "ENOENT") {
    return true
  }

  const message = error instanceof Error
    ? error.message
    : (typeof error === "string" ? error : undefined)
  if (!message) {
    return false
  }

  return /\bENOENT\b/iu.test(message)
    || /spawn\s+codex/iu.test(message)
    || /codex.*(?:command not found|not found|not recognized|no such file)/iu.test(message)
    || /(?:command not found|not found|not recognized|no such file).*codex/iu.test(message)
}

class CodexStreamCapture {
  private readonly logContext: ReturnType<typeof workflowNodeLogContext>
  private readonly label: string
  private readonly filePath: string | undefined
  private textValue = ""
  private textTruncated = false
  private artifactBytes = 0
  private artifactTruncated = false
  private artifactWrites: Promise<void> = Promise.resolve()

  constructor(input: {
    readonly logContext: ReturnType<typeof workflowNodeLogContext>
    readonly label: string
    readonly filePath?: string
  }) {
    this.logContext = input.logContext
    this.label = input.label
    this.filePath = input.filePath
  }

  readonly handleLine = (line: string): void => {
    const chunk = `${line}\n`
    this.appendPreview(chunk)
    this.appendArtifact(chunk)
  }

  text(): string {
    return this.textValue
  }

  async waitForArtifactWrites(): Promise<void> {
    await this.artifactWrites
  }

  private appendPreview(chunk: string): void {
    if (this.textTruncated) return
    const available = CODEX_STREAM_PREVIEW_MAX_CHARS - this.textValue.length
    if (chunk.length <= available) {
      this.textValue += chunk
      return
    }

    if (available > 0) {
      this.textValue += chunk.slice(0, available)
    }
    this.textValue = truncateWithEllipsis(this.textValue, CODEX_STREAM_PREVIEW_MAX_CHARS)
    this.textTruncated = true
  }

  private appendArtifact(chunk: string): void {
    if (!this.filePath || this.artifactTruncated) return
    const sanitized = sanitizeError(chunk)
    const byteLength = Buffer.byteLength(sanitized, "utf8")
    if (this.artifactBytes + byteLength > CODEX_STREAM_ARTIFACT_MAX_BYTES) {
      this.artifactTruncated = true
      this.enqueueArtifactWrite(CODEX_STREAM_TRUNCATED_NOTICE)
      return
    }

    this.artifactBytes += byteLength
    this.enqueueArtifactWrite(sanitized)
  }

  private enqueueArtifactWrite(content: string): void {
    if (!this.filePath) return
    const filePath = this.filePath
    this.artifactWrites = this.artifactWrites
      .then(() => appendFile(filePath, content, "utf8"))
      .catch((error: unknown) => {
        warnArtifactFailure({
          logContext: this.logContext,
          label: this.label,
          filePath,
          error,
        })
      })
  }
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
}): Promise<boolean> {
  try {
    await input.task()
    return true
  } catch (error) {
    warnArtifactFailure({
      logContext: input.logContext,
      label: input.label,
      filePath: input.filePath,
      error,
    })
    return false
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
