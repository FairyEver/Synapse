import type { ControlledProcessRunner } from "../../runtime/process"
import type { TaskActionExecutionInput, TaskActionExecutionResult, TaskActionExecutor } from "./types"

const UNLIMITED_OUTPUT_BYTES = Number.MAX_SAFE_INTEGER

export class ShellTaskAction implements TaskActionExecutor {
  readonly type = "shell_command" as const

  constructor(private readonly deps: {
    readonly processRunner: Pick<ControlledProcessRunner, "run">
    readonly platform?: NodeJS.Platform
    readonly baseEnv?: NodeJS.ProcessEnv
  }) {}

  async execute(input: TaskActionExecutionInput): Promise<TaskActionExecutionResult> {
    const action = input.task.action
    const platform = this.deps.platform ?? process.platform
    const shell = platform === "win32"
      ? { command: "cmd.exe", args: ["/d", "/s", "/c", action.content] }
      : { command: "/bin/sh", args: ["-lc", action.content] }
    const timeoutMs = action.timeoutMins === null ? undefined : (action.timeoutMins ?? 30) * 60_000
    const result = await this.deps.processRunner.run({
      actor: { kind: "user", id: "task-scheduler", display: "Task Scheduler" },
      action: "shell.exec",
      command: shell.command,
      args: shell.args,
      cwd: input.cwd,
      env: mergeEnv(this.deps.baseEnv ?? process.env, action.env),
      envAllowlist: action.env ? Object.keys(action.env) : undefined,
      timeoutMs,
      abortSignal: input.abortSignal,
      output: {
        stdout: "buffer",
        stderr: "buffer",
        maxBufferBytes: UNLIMITED_OUTPUT_BYTES,
      },
      metadata: {
        source: "task-scheduler",
        taskId: input.task.id,
        runId: input.runId,
      },
    })
    if (result.timedOut) return { status: "timeout", process: result, error: "shell command timed out" }
    if (input.abortSignal.aborted && result.signal !== null) {
      return { status: "cancelled", process: result, error: "shell command cancelled" }
    }
    if (result.exitCode !== 0 || result.error) {
      return {
        status: "failed",
        process: result,
        error: result.error ?? `shell command exited with ${String(result.exitCode)}`,
      }
    }
    return { status: "success", process: result }
  }
}

function mergeEnv(
  base: NodeJS.ProcessEnv,
  overrides: Record<string, string> | undefined,
): Record<string, string | undefined> {
  return { ...base, ...(overrides ?? {}) }
}
