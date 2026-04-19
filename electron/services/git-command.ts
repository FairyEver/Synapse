import { spawn } from "node:child_process"

type GitCommandSource = "stderr" | "stdout"

type GitCommandResult = {
  stderr: string
  stdout: string
}

type GitCommandOptions = {
  args: string[]
  cwd: string
  fallbackMessage: string
  formatFailureMessage?: (output: string, fallbackMessage: string) => string
  formatSpawnError?: (error: unknown) => string
  onLine?: (line: string, source: GitCommandSource) => void
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
}: GitCommandOptions): Promise<GitCommandResult> {
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
    const stdoutProcessor = createLineProcessor("stdout", onLine)
    const stderrProcessor = createLineProcessor("stderr", onLine)

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
      reject(new Error((formatSpawnError ?? formatDefaultGitSpawnError)(error)))
    })

    childProcess.on("close", (code) => {
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

      reject(new Error(message))
    })
  })
}

function runGitTextCommand(options: GitCommandOptions): Promise<string> {
  return runGitCommand(options).then((result) => result.stdout.trim())
}

export {
  formatDefaultGitSpawnError,
  runGitCommand,
  runGitTextCommand,
}
export type {
  GitCommandResult,
}
