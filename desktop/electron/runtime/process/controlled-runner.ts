import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process"

import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
  PermissionGuard,
  PermissionResult,
} from "../security"

const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
]

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024

export type ControlledProcessAction = Extract<
  PermissionAction,
  "agent.spawn" | "shell.exec"
>

export type ControlledProcessOutputMode = "buffer" | "json-lines" | "ignore"

export interface ControlledProcessOutputOptions {
  readonly stdout?: ControlledProcessOutputMode
  readonly stderr?: ControlledProcessOutputMode
  readonly maxBufferBytes?: number
}

export type ControlledProcessLineHandler = (line: string) => void

export interface ControlledProcessRunRequest {
  readonly actor: ActorIdentity
  readonly action: ControlledProcessAction
  readonly command: string
  readonly args?: readonly string[]
  readonly cwd?: string
  readonly stdin?: string | Uint8Array
  readonly env?: Record<string, string | undefined>
  /** Extends the default allowlist; it never means "pass the whole env". */
  readonly envAllowlist?: readonly string[]
  readonly timeoutMs?: number
  readonly abortSignal?: AbortSignal
  readonly output?: ControlledProcessOutputOptions
  readonly onStdoutLine?: ControlledProcessLineHandler
  readonly onStderrLine?: ControlledProcessLineHandler
  readonly metadata?: Record<string, unknown>
}

export interface ControlledProcessResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout?: string
  readonly stderr?: string
  readonly timedOut: boolean
  readonly durationMs: number
  readonly error?: string
}

export interface ControlledProcessRunnerDeps {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly spawnImpl?: SpawnFn
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

export class ControlledProcessPermissionError extends Error {
  readonly result: PermissionResult

  constructor(result: PermissionResult) {
    super(result.allowed ? "Process permission unexpectedly allowed" : result.reason)
    this.name = "ControlledProcessPermissionError"
    this.result = result
  }
}

export class ControlledProcessOutputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ControlledProcessOutputError"
  }
}

export class ControlledProcessRunner {
  private readonly permissionGuard: PermissionGuard
  private readonly auditSink: AuditSink
  private readonly spawnImpl: SpawnFn

  constructor(deps: ControlledProcessRunnerDeps) {
    this.permissionGuard = deps.permissionGuard
    this.auditSink = deps.auditSink
    this.spawnImpl = deps.spawnImpl ?? ((command, args, options) =>
      spawn(command, [...args], options) as ChildProcessWithoutNullStreams)
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    const startedAt = Date.now()
    const args = request.args ?? []
    const output = request.output ?? {}
    const maxBufferBytes = output.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    const env = buildAllowedEnv(request.env, request.envAllowlist)

    const permission = await this.permissionGuard.check({
      action: request.action,
      actor: request.actor,
      resource: request.command,
      context: {
        args,
        cwd: request.cwd,
        envKeys: Object.keys(env).sort(),
        output: {
          stdout: output.stdout ?? "buffer",
          stderr: output.stderr ?? "buffer",
        },
        stdinBytes: stdinBytes(request.stdin),
        stream: {
          stdoutLine: request.onStdoutLine !== undefined,
          stderrLine: request.onStderrLine !== undefined,
        },
        timeoutMs: request.timeoutMs,
        ...request.metadata,
      },
    })

    if (!permission.allowed) {
      this.auditSink.record({
        action: request.action,
        actor: request.actor,
        resource: request.command,
        outcome: "denied",
        metadata: {
          reason: permission.reason,
          policyId: permission.policyId,
          cwd: request.cwd,
        },
      })
      throw new ControlledProcessPermissionError(permission)
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnImpl(request.command, args, {
        cwd: request.cwd,
        env,
        windowsHide: true,
        shell: false,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordFailed(request, startedAt, message)
      throw error
    }

    const stdoutCollector = new OutputCollector(output.stdout ?? "buffer", maxBufferBytes)
    const stderrCollector = new OutputCollector(output.stderr ?? "buffer", maxBufferBytes)
    let timedOut = false
    let outputError: Error | null = null
    let spawnError: Error | null = null
    const stdoutLines = new LineEmitter(request.onStdoutLine, (error) => {
      outputError = error
      child.kill("SIGTERM")
    })
    const stderrLines = new LineEmitter(request.onStderrLine, (error) => {
      outputError = error
      child.kill("SIGTERM")
    })

    const killForOutputFailure = (error: Error) => {
      outputError = error
      child.kill("SIGTERM")
    }

    child.stdout.on("data", (chunk: Buffer) => {
      try {
        stdoutCollector.push(chunk)
        stdoutLines.push(chunk)
      } catch (error) {
        killForOutputFailure(error as Error)
      }
    })
    child.stderr.on("data", (chunk: Buffer) => {
      try {
        stderrCollector.push(chunk)
        stderrLines.push(chunk)
      } catch (error) {
        killForOutputFailure(error as Error)
      }
    })

    if (request.stdin !== undefined) {
      child.stdin.end(request.stdin)
    }

    const timeout = request.timeoutMs === undefined
      ? null
      : setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, request.timeoutMs)

    const onAbort = () => {
      child.kill("SIGTERM")
    }
    request.abortSignal?.addEventListener("abort", onAbort, { once: true })

    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("error", (error) => {
        spawnError = error
      })
      child.once("close", (code, signal) => {
        resolve({ code, signal })
      })
    })

    if (timeout) clearTimeout(timeout)
    request.abortSignal?.removeEventListener("abort", onAbort)
    try {
      stdoutLines.flush()
      stderrLines.flush()
    } catch (error) {
      outputError = error as Error
    }

    const stdout = stdoutCollector.text()
    const stderr = stderrCollector.text()
    const durationMs = Date.now() - startedAt
    const error = errorMessage(outputError) ?? errorMessage(spawnError)

    const result: ControlledProcessResult = {
      exitCode: closed.code,
      signal: closed.signal,
      stdout,
      stderr,
      timedOut,
      durationMs,
      error,
    }

    const jsonLinesError = validateJsonLineOutput(output, result)
    const finalError = jsonLinesError ?? outputError
    const outcome = result.exitCode === 0 && !timedOut && !spawnError && !finalError
      ? "allowed"
      : "failed"

    this.auditSink.record({
      action: request.action,
      actor: request.actor,
      resource: request.command,
      outcome,
      metadata: {
        args,
        cwd: request.cwd,
        durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut,
        error: errorMessage(finalError) ?? errorMessage(spawnError),
      },
    })

    if (finalError) {
      throw finalError
    }

    return result
  }

  private recordFailed(
    request: ControlledProcessRunRequest,
    startedAt: number,
    error: string,
  ): void {
    this.auditSink.record({
      action: request.action,
      actor: request.actor,
      resource: request.command,
      outcome: "failed",
      metadata: {
        args: request.args ?? [],
        cwd: request.cwd,
        durationMs: Date.now() - startedAt,
        error,
      },
    })
  }
}

class OutputCollector {
  private readonly mode: ControlledProcessOutputMode
  private readonly maxBufferBytes: number
  private readonly chunks: Buffer[] = []
  private bytes = 0

  constructor(mode: ControlledProcessOutputMode, maxBufferBytes: number) {
    this.mode = mode
    this.maxBufferBytes = maxBufferBytes
  }

  push(chunk: Buffer): void {
    if (this.mode === "ignore") return
    this.bytes += chunk.byteLength
    if (this.bytes > this.maxBufferBytes) {
      throw new ControlledProcessOutputError(
        `Process output exceeded ${this.maxBufferBytes} bytes`,
      )
    }
    this.chunks.push(chunk)
  }

  text(): string | undefined {
    if (this.mode === "ignore") return undefined
    return Buffer.concat(this.chunks).toString("utf8")
  }
}

class LineEmitter {
  private readonly handler: ControlledProcessLineHandler | undefined
  private readonly onError: (error: Error) => void
  private pending = ""

  constructor(
    handler: ControlledProcessLineHandler | undefined,
    onError: (error: Error) => void,
  ) {
    this.handler = handler
    this.onError = onError
  }

  push(chunk: Buffer): void {
    if (!this.handler) return
    this.pending += chunk.toString("utf8")
    const parts = this.pending.split(/\r?\n/)
    this.pending = parts.pop() ?? ""
    for (const line of parts) {
      this.emit(line)
    }
  }

  flush(): void {
    if (!this.handler || this.pending === "") return
    const line = this.pending.replace(/\r$/, "")
    this.pending = ""
    if (line !== "") this.emit(line)
  }

  private emit(line: string): void {
    try {
      this.handler?.(line)
    } catch (error) {
      this.onError(error instanceof Error ? error : new Error(String(error)))
    }
  }
}

function buildAllowedEnv(
  env: Record<string, string | undefined> | undefined,
  envAllowlist: readonly string[] | undefined,
): NodeJS.ProcessEnv {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(envAllowlist ?? [])])
  const nextEnv: NodeJS.ProcessEnv = {}

  for (const key of allowlist) {
    if (!key) continue
    const value = env?.[key] ?? process.env[key]
    if (value !== undefined) {
      nextEnv[key] = value
    }
  }

  return nextEnv
}

function validateJsonLineOutput(
  output: ControlledProcessOutputOptions,
  result: ControlledProcessResult,
): ControlledProcessOutputError | null {
  if (output.stdout === "json-lines" && result.stdout !== undefined) {
    const error = parseJsonLines("stdout", result.stdout)
    if (error) return error
  }
  if (output.stderr === "json-lines" && result.stderr !== undefined) {
    const error = parseJsonLines("stderr", result.stderr)
    if (error) return error
  }
  return null
}

function parseJsonLines(name: string, value: string): ControlledProcessOutputError | null {
  const lines = value.split(/\r?\n/)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]?.trim()
    if (!line) continue
    try {
      JSON.parse(line)
    } catch {
      return new ControlledProcessOutputError(
        `${name} line ${i + 1} is not valid JSON`,
      )
    }
  }
  return null
}

function errorMessage(error: Error | null): string | undefined {
  return error ? error.message : undefined
}

function stdinBytes(stdin: string | Uint8Array | undefined): number | undefined {
  if (stdin === undefined) return undefined
  if (typeof stdin === "string") return Buffer.byteLength(stdin)
  return stdin.byteLength
}

export function createControlledProcessRunner(
  deps: ControlledProcessRunnerDeps,
): ControlledProcessRunner {
  return new ControlledProcessRunner(deps)
}
