import { appendFile, stat } from "node:fs/promises"
import { app } from "electron"
import path from "node:path"

import { createMainLogger } from "../../electron/services/log-store"
import { sanitizeError, sanitizeErrorPreservingPaths } from "../../electron/services/error-sanitize"
import { interpolatePrompt } from "../../electron/services/workflow/variable-resolver"
import { truncateWithEllipsis } from "../../electron/services/workflow/workflow-utils"
import { workflowNodeLogContext } from "../log-context"
import { createWorkflowExternalPathResources } from "../path-resource-metadata"
import type { NodeExecutionInput, NodeExecutionResult, NodeExecutor } from "../types"
import {
  buildClaudeCodeDebugOutput,
  claudeCodeArtifactPaths,
  ensureClaudeCodeArtifactDirectory,
  finalOutputFromClaudeCodeResult,
  writeClaudeCodeArtifact,
  type ClaudeCodeNodeDebugOutput,
} from "./artifacts.main"
import { buildClaudeCodePrintRequest } from "./command"
import type { ClaudeCodeNodeConfig } from "./schema"

const logger = createMainLogger("workflow.node.claude-code-executor")
const CLAUDE_CODE_STREAM_PREVIEW_MAX_CHARS = 64 * 1024
const CLAUDE_CODE_STREAM_ARTIFACT_MAX_BYTES = 5 * 1024 * 1024
const CLAUDE_CODE_STREAM_TRUNCATED_NOTICE = "\n[truncated: Claude Code output exceeded artifact limit]\n"
const MISSING_CLAUDE_CODE_CLI_ERROR = "未找到 Claude Code CLI"

export const claudeCodeNodeExecutor: NodeExecutor<ClaudeCodeNodeConfig> = {
  async execute(input: NodeExecutionInput<ClaudeCodeNodeConfig>): Promise<NodeExecutionResult> {
    const start = Date.now()
    const { config, context, resolvedVariables, runtimeDeps } = input
    const logContext = workflowNodeLogContext(context)
    const processRunner = runtimeDeps?.processRunner

    if (!processRunner) {
      return {
        status: "failed",
        output: "",
        error: "Claude Code 执行能力不可用",
        durationMs: Date.now() - start,
      }
    }

    const projectId = config.projectId?.trim() || context.projectId?.trim()
    if (!projectId) {
      return {
        status: "failed",
        output: "",
        error: "Claude Code 节点缺少项目",
        durationMs: Date.now() - start,
      }
    }

    const resolveProjectWorkspacePath = runtimeDeps?.resolveProjectWorkspacePath
    if (!resolveProjectWorkspacePath) {
      return {
        status: "failed",
        output: "",
        error: "Claude Code 项目路径解析能力不可用",
        durationMs: Date.now() - start,
      }
    }

    input.onProgress?.("resolving_project", "解析项目…")
    const projectWorkspacePath = await resolveProjectWorkspacePath(projectId)
    if (!projectWorkspacePath) {
      return {
        status: "failed",
        output: "",
        error: "Claude Code 节点项目不存在",
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
      cwd = await resolveClaudeCodeWorkingDirectory({
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

    let resolvedPathConfig: Pick<ClaudeCodeNodeConfig, "additionalDirectories" | "settingsPath" | "mcpConfigPath">
    try {
      resolvedPathConfig = await resolveClaudeCodeAdvancedPaths({
        cwd,
        additionalDirectories: config.additionalDirectories,
        settingsPath: config.settingsPath,
        mcpConfigPath: config.mcpConfigPath,
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
    const requestConfig: ClaudeCodeNodeConfig = { ...config, ...resolvedPathConfig }
    const externalPathResources = createWorkflowExternalPathResources([
      ...requestConfig.additionalDirectories.map((resolvedPath) => ({
        source: "claude_code.additionalDirectories",
        path: resolvedPath,
        cwd,
        kind: "directory" as const,
        access: "read_write" as const,
      })),
      {
        source: "claude_code.settingsPath",
        path: requestConfig.settingsPath,
        cwd,
        kind: "file" as const,
        access: "read" as const,
      },
      {
        source: "claude_code.mcpConfigPath",
        path: requestConfig.mcpConfigPath,
        cwd,
        kind: "file" as const,
        access: "read" as const,
      },
    ])

    const actor = context.actor ?? { kind: "system" as const, id: "workflow-engine" }
    const timeoutMs = config.timeoutMins === undefined ? undefined : config.timeoutMins * 60_000
    const captureDebugArtifacts = config.captureDebugArtifacts
    const artifactPaths = claudeCodeArtifactPaths(
      app.getPath("userData"),
      context.runId,
      context.nodeId ?? "unknown-node",
    )

    if (captureDebugArtifacts) {
      await bestEffortArtifactWrite({
        logContext,
        label: "artifact directory",
        task: () => ensureClaudeCodeArtifactDirectory(artifactPaths),
      })
      await bestEffortArtifactWrite({
        logContext,
        label: "prompt artifact",
        filePath: artifactPaths.promptPath,
        task: () => writeClaudeCodeArtifact(artifactPaths.promptPath, prompt),
      })
      await bestEffortArtifactWrite({
        logContext,
        label: "stdout artifact",
        filePath: artifactPaths.stdoutPath,
        task: () => writeClaudeCodeArtifact(artifactPaths.stdoutPath, ""),
      })
      await bestEffortArtifactWrite({
        logContext,
        label: "stderr artifact",
        filePath: artifactPaths.stderrPath,
        task: () => writeClaudeCodeArtifact(artifactPaths.stderrPath, ""),
      })
    }

    const stdoutCapture = new ClaudeCodeStreamCapture({
      logContext,
      label: "stdout artifact",
      filePath: captureDebugArtifacts ? artifactPaths.stdoutPath : undefined,
    })
    const stderrCapture = new ClaudeCodeStreamCapture({
      logContext,
      label: "stderr artifact",
      filePath: captureDebugArtifacts ? artifactPaths.stderrPath : undefined,
    })

    const request = buildClaudeCodePrintRequest({
      config: requestConfig,
      prompt,
      cwd,
      actor,
      timeoutMs,
      abortSignal: context.abortSignal,
      onStdoutLine: stdoutCapture.handleLine,
      onStderrLine: stderrCapture.handleLine,
      metadata: {
        source: "workflow",
        actionType: "workflow.claude_code",
        workflowId: context.workflowId,
        workflowRunId: context.runId,
        workflowNodeId: context.nodeId,
        workflowNodeName: context.nodeName,
        ...(externalPathResources.length > 0 ? { externalPathResources } : {}),
      },
    })

    logger.info("claude code node executing", {
      ...logContext,
      projectId,
      cwd,
      promptLength: prompt.length,
      timeoutMs,
    })

    input.onProgress?.("running_claude_code", "执行 Claude Code…")
    try {
      const result = await processRunner.run(request)
      await Promise.all([
        stdoutCapture.waitForArtifactWrites(),
        stderrCapture.waitForArtifactWrites(),
      ])
      const durationMs = Date.now() - start
      const stdout = result.stdout ?? stdoutCapture.text()
      const stderr = result.stderr ?? stderrCapture.text()
      const claudeCodeDebug = buildDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: result.exitCode,
        signal: result.signal ?? undefined,
        durationMs: result.durationMs,
        captureDebugArtifacts,
        artifactPaths,
        stdout,
        stderr,
      })
      const outputs = { claudeCodeDebug }

      if (context.abortSignal.aborted) {
        logger.warn("claude code node cancelled", {
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
        logger.warn("claude code node timed out", {
          ...logContext,
          projectId,
          cwd,
          durationMs,
        })
        return {
          status: "failed",
          output: "",
          outputs,
          error: "Claude Code 执行超时",
          durationMs,
        }
      }

      if (result.error || result.exitCode !== 0) {
        const error = failureMessageFromResult({ ...result, stdout, stderr })
        logger.warn("claude code node failed", {
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

      const output = finalOutputFromClaudeCodeResult(stdout, requestConfig.outputFormat)
      input.onProgress?.("processing_output", "处理输出…")
      if (captureDebugArtifacts) {
        const lastMessageWritten = await bestEffortArtifactWrite({
          logContext,
          label: "last message artifact",
          filePath: artifactPaths.lastMessagePath,
          task: () => writeClaudeCodeArtifact(artifactPaths.lastMessagePath, output),
        })
        if (lastMessageWritten) {
          outputs.claudeCodeDebug = buildDebugOutput({
            args: request.args ?? [],
            cwd,
            exitCode: result.exitCode,
            signal: result.signal ?? undefined,
            durationMs: result.durationMs,
            captureDebugArtifacts,
            artifactPaths,
            includeLastMessagePath: true,
            stdout,
            stderr,
          })
        }
      }

      logger.info("claude code node succeeded", {
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
      const claudeCodeDebug = buildDebugOutput({
        args: request.args ?? [],
        cwd,
        exitCode: null,
        durationMs,
        captureDebugArtifacts,
        artifactPaths,
        stdout,
        stderr,
      })
      const outputs = { claudeCodeDebug }

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
      const visibleError = isMissingClaudeCodeCliError(error)
        ? MISSING_CLAUDE_CODE_CLI_ERROR
        : `Claude Code 执行异常：${sanitized}`
      logger.warn("claude code node threw exception", {
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
    }
  },
}

async function resolveClaudeCodeWorkingDirectory(input: {
  readonly projectWorkspacePath: string
  readonly workingDirectory?: string
  readonly resolvedVariables: Record<string, string>
}): Promise<string> {
  const template = input.workingDirectory?.trim()
  const rendered = template
    ? interpolatePrompt(template, input.resolvedVariables).trim()
    : input.projectWorkspacePath
  if (!rendered) {
    throw new Error("Claude Code 工作目录不能为空")
  }

  const cwd = path.isAbsolute(rendered)
    ? path.resolve(rendered)
    : path.resolve(input.projectWorkspacePath, rendered)
  let stats
  try {
    stats = await stat(cwd)
  } catch {
    throw new Error("Claude Code 工作目录不存在")
  }
  if (!stats.isDirectory()) {
    throw new Error("Claude Code 工作目录不是文件夹")
  }
  return cwd
}

async function resolveClaudeCodeAdvancedPaths(input: {
  readonly cwd: string
  readonly additionalDirectories: readonly string[]
  readonly settingsPath?: string
  readonly mcpConfigPath?: string
  readonly resolvedVariables: Record<string, string>
}): Promise<Pick<ClaudeCodeNodeConfig, "additionalDirectories" | "settingsPath" | "mcpConfigPath">> {
  return {
    additionalDirectories: await resolveClaudeCodePathList({
      basePath: input.cwd,
      values: input.additionalDirectories,
      resolvedVariables: input.resolvedVariables,
      label: "Claude Code 额外目录",
      expectedType: "directory",
    }),
    settingsPath: await resolveOptionalClaudeCodePath({
      basePath: input.cwd,
      value: input.settingsPath,
      resolvedVariables: input.resolvedVariables,
      label: "Claude Code settings 路径",
      expectedType: "file",
    }),
    mcpConfigPath: await resolveOptionalClaudeCodePath({
      basePath: input.cwd,
      value: input.mcpConfigPath,
      resolvedVariables: input.resolvedVariables,
      label: "Claude Code MCP 配置路径",
      expectedType: "file",
    }),
  }
}

async function resolveClaudeCodePathList(input: {
  readonly basePath: string
  readonly values: readonly string[]
  readonly resolvedVariables: Record<string, string>
  readonly label: string
  readonly expectedType: "directory" | "file"
}): Promise<string[]> {
  const resolved: string[] = []
  for (const value of input.values) {
    resolved.push(await resolveRequiredClaudeCodePath({ ...input, value }))
  }
  return resolved
}

async function resolveOptionalClaudeCodePath(input: {
  readonly basePath: string
  readonly value?: string
  readonly resolvedVariables: Record<string, string>
  readonly label: string
  readonly expectedType: "directory" | "file"
}): Promise<string | undefined> {
  if (input.value === undefined) return undefined
  return resolveRequiredClaudeCodePath({
    basePath: input.basePath,
    value: input.value,
    resolvedVariables: input.resolvedVariables,
    label: input.label,
    expectedType: input.expectedType,
  })
}

async function resolveRequiredClaudeCodePath(input: {
  readonly basePath: string
  readonly value: string
  readonly resolvedVariables: Record<string, string>
  readonly label: string
  readonly expectedType: "directory" | "file"
}): Promise<string> {
  let rendered: string
  try {
    rendered = interpolatePrompt(input.value, input.resolvedVariables).trim()
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
  return absolutePath
}

function buildDebugOutput(input: {
  readonly args: readonly string[]
  readonly cwd: string
  readonly exitCode: number | null
  readonly signal?: string
  readonly durationMs: number
  readonly captureDebugArtifacts: boolean
  readonly artifactPaths: ReturnType<typeof claudeCodeArtifactPaths>
  readonly includeLastMessagePath?: boolean
  readonly stdout?: string
  readonly stderr?: string
}): ClaudeCodeNodeDebugOutput {
  return buildClaudeCodeDebugOutput({
    args: input.args,
    cwd: input.cwd,
    exitCode: input.exitCode,
    signal: input.signal,
    durationMs: input.durationMs,
    ...(input.captureDebugArtifacts
      ? {
          stdoutPath: input.artifactPaths.stdoutPath,
          stderrPath: input.artifactPaths.stderrPath,
          promptPath: input.artifactPaths.promptPath,
          ...(input.includeLastMessagePath ? { lastMessagePath: input.artifactPaths.lastMessagePath } : {}),
        }
      : {}),
    stdout: input.stdout,
    stderr: input.stderr,
  })
}

function failureMessageFromResult(result: {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout?: string
  readonly stderr?: string
  readonly error?: string
}): string {
  if (isMissingClaudeCodeCliError(result.error)) {
    return MISSING_CLAUDE_CODE_CLI_ERROR
  }

  const stdout = result.stdout?.trim()
  const stderr = result.stderr?.trim()
  const streamError = [stdout, stderr].find((value) => value && CLAUDE_CODE_ERROR_SIGNAL_PATTERN.test(value))
  const candidate = result.error?.trim()
    || streamError
    || stderr
    || stdout
    || (result.signal ? `Claude Code 被信号 ${result.signal} 终止` : undefined)
    || (result.exitCode !== null ? `Claude Code 退出码 ${String(result.exitCode)}` : "Claude Code 执行失败")

  return `Claude Code 执行失败：${truncateWithEllipsis(sanitizeError(candidate), 120)}`
}

const CLAUDE_CODE_ERROR_SIGNAL_PATTERN = /\b(?:api error|error|failed|failure|unauthenticated|unauthorized|forbidden|quota|denied|exception)\b/iu

function isMissingClaudeCodeCliError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code).toUpperCase()
    : undefined
  if (code === "ENOENT") return true

  const message = error instanceof Error
    ? error.message
    : (typeof error === "string" ? error : undefined)
  if (!message) return false

  return /\bENOENT\b/iu.test(message)
    || /spawn\s+claude/iu.test(message)
    || /claude.*(?:command not found|not found|not recognized|no such file)/iu.test(message)
    || /(?:command not found|not found|not recognized|no such file).*claude/iu.test(message)
}

class ClaudeCodeStreamCapture {
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
    const available = CLAUDE_CODE_STREAM_PREVIEW_MAX_CHARS - this.textValue.length
    if (chunk.length <= available) {
      this.textValue += chunk
      return
    }

    if (available > 0) {
      this.textValue += chunk.slice(0, available)
    }
    this.textValue = truncateWithEllipsis(this.textValue, CLAUDE_CODE_STREAM_PREVIEW_MAX_CHARS)
    this.textTruncated = true
  }

  private appendArtifact(chunk: string): void {
    if (!this.filePath || this.artifactTruncated) return
    const sanitized = sanitizeErrorPreservingPaths(chunk)
    const byteLength = Buffer.byteLength(sanitized, "utf8")
    if (this.artifactBytes + byteLength > CLAUDE_CODE_STREAM_ARTIFACT_MAX_BYTES) {
      this.artifactTruncated = true
      this.enqueueArtifactWrite(CLAUDE_CODE_STREAM_TRUNCATED_NOTICE)
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
  logger.warn("claude code node artifact I/O failed", {
    ...input.logContext,
    artifact: input.label,
    filePath: input.filePath,
    errorMessage: truncateWithEllipsis(
      sanitizeError(input.error instanceof Error ? input.error.message : String(input.error)),
      200,
    ),
  })
}

export type { ClaudeCodeNodeDebugOutput }
