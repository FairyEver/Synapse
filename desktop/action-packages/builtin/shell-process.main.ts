import type { ControlledProcessRunner } from "../../electron/runtime/process"
import { resolveShellCommand } from "../../electron/services/shell-exec"
import type { ActionRunResult } from "../types"
import type { ActionRuntimeContext } from "../../electron/action-runtime/action-registry"

const UNLIMITED_OUTPUT_BYTES = Number.MAX_SAFE_INTEGER

export type ShellActionConfig = {
  readonly shell: "posix" | "cmd" | "powershell"
  readonly env?: Record<string, string>
  readonly timeoutMins?: number | null
}

export async function runShellAction(input: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly content: string
  readonly config: ShellActionConfig
  readonly context: ActionRuntimeContext
}): Promise<ActionRunResult> {
  const platform = input.platform ?? process.platform
  const shell = resolveShellCommand(input.config.shell, input.content, {
    platform,
    windowsDefault: "cmd",
  })
  const timeoutMs = input.config.timeoutMins === null
    ? undefined
    : (input.config.timeoutMins ?? 30) * 60_000
  const result = await input.processRunner.run({
    actor: input.context.actor,
    action: "shell.exec",
    command: shell.command,
    args: [...shell.args],
    cwd: input.context.cwd,
    env: { ...(input.baseEnv ?? process.env), ...(input.config.env ?? {}) },
    envAllowlist: input.config.env ? Object.keys(input.config.env) : undefined,
    timeoutMs,
    abortSignal: input.context.abortSignal,
    output: {
      stdout: "buffer",
      stderr: "buffer",
      maxBufferBytes: UNLIMITED_OUTPUT_BYTES,
    },
    metadata: {
      source: "task-scheduler",
      actionType: "shell",
      taskId: input.context.taskId,
      runId: input.context.runId,
      triggeredBy: input.context.triggeredBy,
    },
  })

  const logs = [
    result.stdout ? { label: "stdout", value: result.stdout } : undefined,
    result.stderr ? { label: "stderr", value: result.stderr } : undefined,
  ].filter((item): item is { label: string; value: string } => item !== undefined)
  const metrics = {
    durationMs: result.durationMs,
    exitCode: result.exitCode,
  }
  const outputs = {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.exitCode,
  }

  if (result.timedOut) {
    return {
      status: "timeout",
      summary: "超时",
      logs,
      outputs,
      error: "shell command timed out",
      metrics,
    }
  }
  if (input.context.abortSignal.aborted && result.signal !== null) {
    return {
      status: "cancelled",
      summary: "已停止",
      logs,
      outputs,
      error: "shell command cancelled",
      metrics,
    }
  }
  if (result.exitCode !== 0 || result.error) {
    return {
      status: "failed",
      summary: `退出码 ${String(result.exitCode)}`,
      logs,
      outputs,
      error: result.error ?? `shell command exited with ${String(result.exitCode)}`,
      metrics,
    }
  }
  return {
    status: "success",
    summary: `退出码 ${String(result.exitCode)}`,
    logs,
    outputs,
    metrics,
  }
}
