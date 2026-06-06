import type { ControlledProcessRunner, PathStrategy } from "../../electron/runtime/process"
import {
  renderActionTemplate,
  renderStringRecordTemplates,
} from "../../electron/action-runtime/template-variables"
import { resolveShellCommand } from "../../electron/services/shell-exec"
import type { ActionRunResult } from "../types"
import type { ActionRuntimeContext } from "../../electron/action-runtime/action-registry"

export type ShellActionConfig = {
  readonly shell: "posix" | "cmd" | "powershell"
  readonly env?: Record<string, string>
  readonly pathStrategy?: PathStrategy
  readonly posixLogin?: boolean
  readonly timeoutMins?: number | null
}

export async function runShellAction(input: {
  readonly processRunner: Pick<ControlledProcessRunner, "run">
  readonly platform?: NodeJS.Platform
  readonly baseEnv?: NodeJS.ProcessEnv
  readonly content: string
  readonly config: ShellActionConfig
  readonly context: ActionRuntimeContext
  readonly auditSource?: string
  readonly auditActionType?: string
}): Promise<ActionRunResult> {
  const platform = input.platform ?? process.platform
  const content = renderActionTemplate(input.content, input.context.templateVariables)
  const env = renderStringRecordTemplates(input.config.env, input.context.templateVariables)
  const shell = resolveShellCommand(input.config.shell, content, {
    platform,
    posixLogin: input.config.posixLogin,
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
    env,
    envAllowlist: env ? Object.keys(env) : undefined,
    pathStrategy: input.config.pathStrategy,
    timeoutMs,
    abortSignal: input.context.abortSignal,
    output: {
      stdout: "buffer",
      stderr: "buffer",
    },
    metadata: {
      source: input.auditSource ?? "task-scheduler",
      actionType: input.auditActionType ?? "shell",
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
  const outputs: Record<string, unknown> = {
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
  if (input.context.abortSignal.aborted) {
    return {
      status: "cancelled",
      summary: "已停止",
      logs,
      outputs,
      error: "shell command cancelled",
      metrics,
    }
  }
  if (result.exitCode === null) {
    const signalInfo = result.signal ? `信号 ${result.signal}` : "未知信号"
    return {
      status: "failed",
      summary: `被终止（${signalInfo}）`,
      logs,
      outputs,
      error: `shell command killed by signal ${result.signal ?? "unknown"}`,
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
