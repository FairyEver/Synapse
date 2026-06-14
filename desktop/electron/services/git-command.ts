import { spawn } from "node:child_process"
import { access } from "node:fs/promises"
import path from "node:path"
import type { ControlledProcessRunner } from "../runtime/process"
import type { ActorIdentity } from "../runtime/security"

type GitCommandSource = "stderr" | "stdout"

type GitCommandResult = {
  stderr: string
  stdout: string
}

class GitCommandError extends Error {
  declare readonly output: string
  declare readonly stderr: string
  declare readonly stdout: string

  constructor(message: string, result: GitCommandResult & { readonly output: string }) {
    super(message)
    this.name = "GitCommandError"
    Object.defineProperties(this, {
      output: { enumerable: false, value: result.output },
      stderr: { enumerable: false, value: result.stderr },
      stdout: { enumerable: false, value: result.stdout },
    })
  }
}

type GitCommandOptions = {
  args: string[]
  cwd: string
  fallbackMessage: string
  formatFailureMessage?: (output: string, fallbackMessage: string) => string
  formatSpawnError?: (error: unknown) => string
  onLine?: (line: string, source: GitCommandSource) => void
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
  args,
  cwd,
  fallbackMessage,
  formatFailureMessage,
  formatSpawnError,
  onLine,
  timeoutMessage,
  timeoutMs,
}: GitCommandOptions): Promise<GitCommandResult> {
  const security = gitCommandSecurity
  if (security) {
    return runControlledGitCommand({
      args,
      cwd,
      fallbackMessage,
      formatFailureMessage,
      formatSpawnError,
      onLine,
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

    let stdout = ""
    let stderr = ""
    let combinedOutput = ""
    let settled = false
    const stdoutProcessor = createLineProcessor("stdout", onLine)
    const stderrProcessor = createLineProcessor("stderr", onLine)
    const timeout = timeoutMs && timeoutMs > 0
      ? setTimeout(() => {
          settled = true
          childProcess.kill("SIGTERM")
          reject(new Error(timeoutMessage ?? fallbackMessage))
        }, timeoutMs)
      : null

    childProcess.stdout.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      stdout += text
      combinedOutput += text
      stdoutProcessor.push(text)
    })

    childProcess.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8")

      stderr += text
      combinedOutput += text
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
      reject(new Error((formatSpawnError ?? formatDefaultGitSpawnError)(error)))
    })

    childProcess.on("close", (code) => {
      if (settled) {
        return
      }

      settled = true
      if (timeout) {
        clearTimeout(timeout)
      }
      stdoutProcessor.flush()
      stderrProcessor.flush()

      if (code === 0) {
        resolve({
          stderr,
          stdout,
        })
        return
      }

      const message = formatFailureMessage
        ? formatFailureMessage(combinedOutput, fallbackMessage)
        : stderr.trim() || stdout.trim() || fallbackMessage

      reject(new GitCommandError(message, { output: combinedOutput, stderr, stdout }))
    })
  })
}

async function runControlledGitCommand({
  args,
  cwd,
  fallbackMessage,
  formatFailureMessage,
  formatSpawnError,
  onLine,
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
      cwd,
      env: {
        GIT_TERMINAL_PROMPT: "0",
        LANG: "C",
        LC_ALL: "C",
      },
      envAllowlist: ["GIT_TERMINAL_PROMPT", "LANG", "LC_ALL"],
      timeoutMs,
      output: { stdout: "buffer", stderr: "buffer" },
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
      throw new Error(timeoutMessage ?? fallbackMessage)
    }
    if (result.exitCode === 0) {
      return { stderr, stdout }
    }
    const combinedOutput = `${stdout}${stderr}`
    const message = formatFailureMessage
      ? formatFailureMessage(combinedOutput, fallbackMessage)
      : stderr.trim() || stdout.trim() || fallbackMessage
    throw new GitCommandError(message, { output: combinedOutput, stderr, stdout })
  } catch (error) {
    if (error instanceof Error && error.message) {
      throw error
    }
    throw new Error((formatSpawnError ?? formatDefaultGitSpawnError)(error))
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
