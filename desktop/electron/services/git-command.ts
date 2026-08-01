import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import path from "node:path"
import { StringDecoder } from "node:string_decoder"
import type { ControlledProcessRunner } from "../runtime/process"
import type { ActorIdentity } from "../runtime/security"

type GitCommandSource = "stderr" | "stdout"

type GitCommandResult = {
  stderr: string
  stdout: string
  stderrTruncated?: boolean
  stdoutTruncated?: boolean
}

type GitCommandFailureResult = GitCommandResult & {
  readonly exitCode?: number | null
  readonly output: string
  readonly signal?: NodeJS.Signals | string | null
  readonly timedOut?: boolean
}

class GitCommandError extends Error {
  declare readonly exitCode: number | null | undefined
  declare readonly output: string
  declare readonly signal: NodeJS.Signals | string | null | undefined
  declare readonly stderr: string
  declare readonly stdout: string
  declare readonly timedOut: boolean | undefined

  constructor(message: string, result: GitCommandFailureResult) {
    super(message)
    this.name = "GitCommandError"
    Object.defineProperties(this, {
      exitCode: { enumerable: false, value: result.exitCode },
      output: { enumerable: false, value: result.output },
      signal: { enumerable: false, value: result.signal },
      stderr: { enumerable: false, value: result.stderr },
      stdout: { enumerable: false, value: result.stdout },
      timedOut: { enumerable: false, value: result.timedOut },
    })
  }
}

type GitCommandOptions = {
  acceptedExitCodes?: readonly number[]
  abortSignal?: AbortSignal
  args: string[]
  cwd: string
  fallbackMessage: string
  formatFailureMessage?: (output: string, fallbackMessage: string) => string
  formatSpawnError?: (error: unknown) => string
  onLine?: (line: string, source: GitCommandSource) => void
  maxBufferBytes?: number
  outputOverflow?: "error" | "truncate"
  timeoutMessage?: string
  timeoutMs?: number
}

type GitCommandSecurity = {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly actor?: ActorIdentity
}

let gitCommandSecurity: GitCommandSecurity | null = null

function configureGitCommandSecurity(security: GitCommandSecurity): void {
  gitCommandSecurity = security
}

function resetGitCommandSecurityForTests(): void {
  gitCommandSecurity = null
}

function formatDefaultGitSpawnError(error: unknown): string {
  if (error instanceof Error && "code" in error && error.code === "ENOENT") {
    return "当前系统没有可用的 git 命令，请先安装 Git 并确保命令行可访问。"
  }

  return error instanceof Error ? error.message : "启动 Git 命令失败。"
}

function createLineProcessor(
  source: GitCommandSource,
  onLine?: (line: string, source: GitCommandSource) => void,
) {
  let buffer = ""

  return {
    flush() {
      const trimmedLine = buffer.trim()

      if (trimmedLine) {
        onLine?.(trimmedLine, source)
      }

      buffer = ""
    },
    push(chunk: string) {
      buffer += chunk.replace(/\r/g, "\n")
      const lines = buffer.split("\n")
      buffer = lines.pop() ?? ""

      for (const line of lines) {
        const trimmedLine = line.trim()

        if (trimmedLine) {
          onLine?.(trimmedLine, source)
        }
      }
    },
  }
}

function runGitCommand({
  acceptedExitCodes = [0],
  abortSignal,
  args,
  cwd,
  fallbackMessage,
  formatFailureMessage,
  formatSpawnError,
  onLine,
  maxBufferBytes,
  outputOverflow = "error",
  timeoutMessage,
  timeoutMs,
}: GitCommandOptions): Promise<GitCommandResult> {
  const security = gitCommandSecurity
  if (security) {
    return runControlledGitCommand({
      acceptedExitCodes,
      abortSignal,
      args,
      cwd,
      fallbackMessage,
      formatFailureMessage,
      formatSpawnError,
      onLine,
      maxBufferBytes,
      outputOverflow,
      security,
      timeoutMessage,
      timeoutMs,
    })
  }

  return new Promise((resolve, reject) => {
    const childProcess = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
    })

    const stdoutBuffer = new GitOutputBuffer(maxBufferBytes, outputOverflow)
    const stderrBuffer = new GitOutputBuffer(maxBufferBytes, outputOverflow)
    let settled = false
    const stdoutProcessor = createLineProcessor("stdout", onLine)
    const stderrProcessor = createLineProcessor("stderr", onLine)
    const timeout = timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          settled = true
          childProcess.kill("SIGTERM")
          reject(new GitCommandError(timeoutMessage ?? fallbackMessage, {
            exitCode: null,
            output: `${stderrBuffer.text()}${stdoutBuffer.text()}`,
            signal: "SIGTERM",
            stderr: stderrBuffer.text(),
            stdout: stdoutBuffer.text(),
            timedOut: true,
          }))
        }, timeoutMs)
      : null
    const onAbort = () => childProcess.kill("SIGTERM")
    if (abortSignal?.aborted) onAbort()
    else abortSignal?.addEventListener("abort", onAbort, { once: true })

    childProcess.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      try {
        stdoutBuffer.push(chunk)
      } catch (error) {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        abortSignal?.removeEventListener("abort", onAbort)
        childProcess.kill("SIGTERM")
        reject(error)
        return
      }
      stdoutProcessor.push(text)
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      try {
        stderrBuffer.push(chunk)
      } catch (error) {
        if (settled) return
        settled = true
        if (timeout) clearTimeout(timeout)
        abortSignal?.removeEventListener("abort", onAbort)
        childProcess.kill("SIGTERM")
        reject(error)
        return
      }
      stderrProcessor.push(text)
    })

    childProcess.on("error", (error) => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      abortSignal?.removeEventListener("abort", onAbort)
      reject(new Error((formatSpawnError ?? formatDefaultGitSpawnError)(error)))
    })

    childProcess.on("close", (code, signal) => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      abortSignal?.removeEventListener("abort", onAbort)
      stdoutProcessor.flush()
      stderrProcessor.flush()
      const stdout = stdoutBuffer.text()
      const stderr = stderrBuffer.text()

      if (code !== null && acceptedExitCodes.includes(code)) {
        resolve({
          stderr,
          stderrTruncated: stderrBuffer.truncated,
          stdout,
          stdoutTruncated: stdoutBuffer.truncated,
        })
        return
      }

      const combinedOutput = `${stderr}${stdout}`
      const message = formatFailureMessage
        ? formatFailureMessage(combinedOutput, fallbackMessage)
        : stderr.trim() || stdout.trim() || fallbackMessage

      reject(new GitCommandError(message, { exitCode: code, output: combinedOutput, signal, stderr, stdout }))
    })
  })
}

async function runControlledGitCommand({
  acceptedExitCodes = [0],
  abortSignal,
  args,
  cwd,
  fallbackMessage,
  formatFailureMessage,
  formatSpawnError,
  onLine,
  maxBufferBytes,
  outputOverflow = "error",
  security,
  timeoutMessage,
  timeoutMs,
}: GitCommandOptions & { readonly security: GitCommandSecurity }): Promise<GitCommandResult> {
  try {
    const result = await security.processRunner.run({
      action: "shell.exec",
      actor: security.actor ?? { kind: "system", id: "git-command" },
      command: "git",
      args,
      abortSignal,
      cwd,
      env: {
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      envAllowlist: ["GIT_TERMINAL_PROMPT", "LANG", "LC_ALL"],
      timeoutMs,
      output: {
        stdout: "buffer",
        stderr: "buffer",
        ...(maxBufferBytes === undefined ? {} : { maxBufferBytes }),
        overflow: outputOverflow,
      },
      onStdoutLine: (line) => onLine?.(line, "stdout"),
      onStderrLine: (line) => onLine?.(line, "stderr"),
      metadata: {
        source: "git-command",
        gitArgs: args,
      },
    })
    const stdout = result.stdout ?? ""
    const stderr = result.stderr ?? ""
    if (result.timedOut) {
      throw new GitCommandError(timeoutMessage ?? fallbackMessage, {
        exitCode: result.exitCode,
        output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
        signal: result.signal,
        stderr: result.stderr ?? "",
        stdout: result.stdout ?? "",
        timedOut: true,
      })
    }
    if (result.exitCode !== null && acceptedExitCodes.includes(result.exitCode)) {
      return {
        stderr,
        stderrTruncated: result.stderrTruncated ?? false,
        stdout,
        stdoutTruncated: result.stdoutTruncated ?? false,
      }
    }
    const combinedOutput = `${stdout}${stderr}`
    const message = formatFailureMessage
      ? formatFailureMessage(combinedOutput, fallbackMessage)
      : stderr.trim() || stdout.trim() || fallbackMessage
    throw new GitCommandError(message, {
      exitCode: result.exitCode,
      output: combinedOutput,
      signal: result.signal,
      stderr,
      stdout,
      timedOut: false,
    })
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error
    }
    throw new Error((formatSpawnError ?? formatDefaultGitSpawnError)(error), { cause: error })
  }
}

class GitOutputBuffer {
  private readonly chunks: Buffer[] = []
  private bytes = 0
  truncated = false

  constructor(
    private readonly maxBytes: number | undefined,
    private readonly overflow: "error" | "truncate",
  ) {}

  push(chunk: Buffer): void {
    if (this.maxBytes === undefined) {
      this.chunks.push(chunk)
      this.bytes += chunk.byteLength
      return
    }
    const remaining = Math.max(0, this.maxBytes - this.bytes)
    if (chunk.byteLength > remaining && this.overflow === "error") {
      throw new Error(`Git command output exceeded ${String(this.maxBytes)} bytes`)
    }
    if (remaining > 0) {
      const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      this.chunks.push(accepted)
      this.bytes += accepted.byteLength
    }
    if (chunk.byteLength > remaining) this.truncated = true
  }

  text(): string {
    const buffer = Buffer.concat(this.chunks)
    return this.truncated ? new StringDecoder("utf8").write(buffer) : buffer.toString("utf8")
  }
}

function runGitTextCommand(options: GitCommandOptions): Promise<string> {
  return runGitCommand(options).then((result) => result.stdout.trim())
}

async function resolveGitPath(cwd: string, gitPath: string): Promise<string | null> {
  try {
    const result = await runGitCommand({
      args: ["rev-parse", "--git-path", gitPath],
      cwd,
      fallbackMessage: "",
      formatFailureMessage: () => "",
    })
    const resolvedPath = result.stdout.trim()
    if (!resolvedPath) return null
    return path.isAbsolute(resolvedPath) ? resolvedPath : path.join(cwd, resolvedPath)
  } catch {
    return null
  }
}

async function gitPathExists(cwd: string, gitPath: string): Promise<boolean> {
  const resolvedPath = await resolveGitPath(cwd, gitPath)
  if (!resolvedPath) return false
  try {
    await access(resolvedPath)
    return true
  } catch {
    return false
  }
}

async function isGitRebaseInProgress(cwd: string): Promise<boolean> {
  return (await gitPathExists(cwd, "rebase-merge")) || (await gitPathExists(cwd, "rebase-apply"))
}

export {
  formatDefaultGitSpawnError,
  configureGitCommandSecurity,
  isGitRebaseInProgress,
  resetGitCommandSecurityForTests,
  runGitCommand,
  runGitTextCommand,
}
export type {
  GitCommandError,
  GitCommandResult,
}
