import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptionsWithoutStdio,
} from "node:child_process"
import { StringDecoder } from "node:string_decoder"

import type {
  ActorIdentity,
  AuditSink,
  PermissionAction,
  PermissionGuard,
  PermissionResult,
} from "../security"
import {
  computePath,
  resolveCachedLoginShellPath,
  resolveExecutableInPath,
  splitPath,
  type PathStrategy,
} from "./shell-environment"

export {
  computePath,
  dedupePath,
  splitPath,
} from "./shell-environment"
export type { PathStrategy } from "./shell-environment"

const DEFAULT_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
  "ComSpec",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
]

const DEFAULT_RUN_AS_ENV_ALLOWLIST = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "TERM",
]

const DEFAULT_MAX_BUFFER_BYTES = 1024 * 1024
const TERMINATION_GRACE_MS = 5_000

export type ControlledProcessAction = Extract<
  PermissionAction,
  "agent.spawn" | "shell.exec"
>

export type ControlledProcessOutputMode = "buffer" | "json-lines" | "ignore"

export interface ControlledProcessOutputOptions {
  readonly stdout?: ControlledProcessOutputMode
  readonly stderr?: ControlledProcessOutputMode
  readonly maxBufferBytes?: number
  readonly overflow?: "error" | "truncate"
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
  readonly pathStrategy?: PathStrategy
  readonly isolation?: ControlledProcessIsolationOptions
  readonly metadata?: Record<string, unknown>
}

export interface ControlledProcessIsolationOptions {
  readonly kind: "run_as_user"
  readonly user: string
  readonly envAllowlist?: readonly string[]
}

export interface ControlledProcessDiagnostics {
  readonly envKeys: readonly string[]
  readonly pathSummary: string
  readonly pathEntries: readonly string[]
  readonly shell: string
  readonly args: readonly string[]
}

export interface ControlledProcessResult {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout?: string
  readonly stderr?: string
  readonly stderrTruncated?: boolean
  readonly stdoutTruncated?: boolean
  readonly timedOut: boolean
  readonly durationMs: number
  readonly error?: string
  readonly diagnostics?: ControlledProcessDiagnostics
}

export interface ControlledProcessSession {
  writeStdin(input: string | Uint8Array): Promise<void>
  endStdin(input?: string | Uint8Array): Promise<void>
  wait(): Promise<ControlledProcessResult>
  close(signal?: NodeJS.Signals): Promise<ControlledProcessResult>
  alive(): boolean
}

export interface ControlledProcessRunnerDeps {
  readonly permissionGuard: PermissionGuard
  readonly auditSink: AuditSink
  readonly spawnImpl?: SpawnFn
  readonly platform?: NodeJS.Platform
  readonly fileExists?: (candidate: string) => boolean
}

type SpawnFn = (
  command: string,
  args: readonly string[],
  options: SpawnOptionsWithoutStdio,
) => ChildProcessWithoutNullStreams

interface ProcessTerminator {
  terminate(signal?: NodeJS.Signals): void
  clear(): void
}

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

function createProcessTerminator(
  child: Pick<ChildProcessWithoutNullStreams, "kill" | "pid">,
  options: { readonly processGroup: boolean },
): ProcessTerminator {
  let forceKillTimeout: ReturnType<typeof setTimeout> | null = null

  const killProcess = (signal: NodeJS.Signals) => {
    if (options.processGroup && typeof child.pid === "number") {
      try {
        process.kill(-child.pid, signal)
        return
      } catch {
        child.kill(signal)
        return
      }
    }
    child.kill(signal)
  }

  return {
    terminate(signal: NodeJS.Signals = "SIGTERM") {
      killProcess(signal)
      if (signal !== "SIGTERM" || forceKillTimeout !== null) return

      forceKillTimeout = setTimeout(() => {
        forceKillTimeout = null
        killProcess("SIGKILL")
      }, TERMINATION_GRACE_MS)
    },
    clear() {
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout)
        forceKillTimeout = null
      }
    },
  }
}

export class ControlledProcessRunner {
  private readonly permissionGuard: PermissionGuard
  private readonly auditSink: AuditSink
  private readonly spawnImpl: SpawnFn
  private readonly platform: NodeJS.Platform
  private readonly fileExists: ((candidate: string) => boolean) | undefined

  constructor(deps: ControlledProcessRunnerDeps) {
    this.permissionGuard = deps.permissionGuard
    this.auditSink = deps.auditSink
    this.spawnImpl = deps.spawnImpl ?? ((command, args, options) =>
      spawn(command, [...args], options) as ChildProcessWithoutNullStreams)
    this.platform = deps.platform ?? process.platform
    this.fileExists = deps.fileExists
  }

  async start(request: ControlledProcessRunRequest): Promise<ControlledProcessSession> {
    const startedAt = Date.now()
    const args = request.args ?? []
    const output = request.output ?? {}
    const maxBufferBytes = output.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    const permissionContext = buildPermissionContext(request, args, output, { longRunning: true })

    const permission = await this.permissionGuard.check({
      action: request.action,
      actor: request.actor,
      resource: request.command,
      context: permissionContext,
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
          ...request.metadata,
        },
      })
      throw new ControlledProcessPermissionError(permission)
    }

    const launch = buildLaunch(request, { platform: this.platform, fileExists: this.fileExists })
    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnImpl(launch.command, launch.args, {
        cwd: request.cwd,
        env: launch.env,
        windowsHide: true,
        shell: false,
        detached: launch.processGroup,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordFailed(request, startedAt, message)
      throw error
    }

    return new ControlledProcessSessionImpl({
      auditSink: this.auditSink,
      child,
      request,
      startedAt,
      output,
      maxBufferBytes,
      launch,
    })
  }

  async run(request: ControlledProcessRunRequest): Promise<ControlledProcessResult> {
    const startedAt = Date.now()
    const args = request.args ?? []
    const output = request.output ?? {}
    const maxBufferBytes = output.maxBufferBytes ?? DEFAULT_MAX_BUFFER_BYTES
    const permissionContext = buildPermissionContext(request, args, output)

    const permission = await this.permissionGuard.check({
      action: request.action,
      actor: request.actor,
      resource: request.command,
      context: permissionContext,
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
          ...request.metadata,
        },
      })
      throw new ControlledProcessPermissionError(permission)
    }

    const launch = buildLaunch(request, { platform: this.platform, fileExists: this.fileExists })
    const launchPathEntries = splitPath(launch.env.PATH ?? "", this.platform === "win32" ? ";" : ":")
    const launchDiagnostics: ControlledProcessDiagnostics = {
      envKeys: Object.keys(launch.env).sort(),
      pathSummary: launchPathEntries.length > 0
        ? `${launchPathEntries[0]}${launchPathEntries.length > 1 ? ` ... (${String(launchPathEntries.length)} entries)` : ""}`
        : "(empty)",
      pathEntries: launchPathEntries,
      shell: launch.command,
      args: [...launch.args],
    }

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnImpl(launch.command, launch.args, {
        cwd: request.cwd,
        env: launch.env,
        windowsHide: true,
        shell: false,
        detached: launch.processGroup,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.recordFailed(request, startedAt, message)
      throw error
    }

    const overflow = output.overflow ?? "error"
    const stdoutCollector = new OutputCollector(output.stdout ?? "buffer", maxBufferBytes, overflow)
    const stderrCollector = new OutputCollector(output.stderr ?? "buffer", maxBufferBytes, overflow)
    const terminator = createProcessTerminator(child, { processGroup: launch.processGroup })
    let timedOut = false
    let outputError: Error | null = null
    let spawnError: Error | null = null
    const stdoutLines = new LineEmitter(request.onStdoutLine, (error) => {
      outputError = error
      terminator.terminate()
    })
    const stderrLines = new LineEmitter(request.onStderrLine, (error) => {
      outputError = error
      terminator.terminate()
    })

    const killForOutputFailure = (error: Error) => {
      outputError = error
      terminator.terminate()
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
        terminator.terminate()
      }, request.timeoutMs)

    const onAbort = () => {
      terminator.terminate()
    }
    if (request.abortSignal?.aborted) {
      terminator.terminate()
    } else {
      request.abortSignal?.addEventListener("abort", onAbort, { once: true })
    }

    const closed = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      child.once("error", (error) => {
        spawnError = error
      })
      child.once("close", (code, signal) => {
        resolve({ code, signal })
      })
    })

    if (timeout) clearTimeout(timeout)
    terminator.clear()
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
      stdoutTruncated: stdoutCollector.truncated(),
      stderrTruncated: stderrCollector.truncated(),
      timedOut,
      durationMs,
      error,
      diagnostics: launchDiagnostics,
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
        launchCommand: launch.command,
        launchArgs: launch.args,
        cwd: request.cwd,
        durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut,
        error: errorMessage(finalError) ?? errorMessage(spawnError),
        isolation: launch.isolationMetadata,
        ...request.metadata,
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
        isolation: request.isolation,
        ...request.metadata,
      },
    })
  }
}

interface ControlledProcessSessionImplDeps {
  readonly auditSink: AuditSink
  readonly child: ChildProcessWithoutNullStreams
  readonly request: ControlledProcessRunRequest
  readonly startedAt: number
  readonly output: ControlledProcessOutputOptions
  readonly maxBufferBytes: number
  readonly launch: ControlledProcessLaunch
}

class ControlledProcessSessionImpl implements ControlledProcessSession {
  private readonly auditSink: AuditSink
  private readonly child: ChildProcessWithoutNullStreams
  private readonly request: ControlledProcessRunRequest
  private readonly startedAt: number
  private readonly output: ControlledProcessOutputOptions
  private readonly stdoutCollector: OutputCollector
  private readonly stderrCollector: OutputCollector
  private readonly stdoutLines: LineEmitter
  private readonly stderrLines: LineEmitter
  private readonly terminator: ProcessTerminator
  private readonly waitPromise: Promise<ControlledProcessResult>
  private outputError: Error | null = null
  private spawnError: Error | null = null
  private timedOut = false
  private isAlive = true

  constructor(deps: ControlledProcessSessionImplDeps) {
    this.auditSink = deps.auditSink
    this.child = deps.child
    this.request = deps.request
    this.startedAt = deps.startedAt
    this.output = deps.output
    this.stdoutCollector = new OutputCollector(
      deps.output.stdout ?? "buffer",
      deps.maxBufferBytes,
      deps.output.overflow ?? "error",
    )
    this.stderrCollector = new OutputCollector(
      deps.output.stderr ?? "buffer",
      deps.maxBufferBytes,
      deps.output.overflow ?? "error",
    )
    this.terminator = createProcessTerminator(this.child, { processGroup: deps.launch.processGroup })
    this.stdoutLines = new LineEmitter(deps.request.onStdoutLine, (error) => {
      this.outputError = error
      this.terminator.terminate()
    })
    this.stderrLines = new LineEmitter(deps.request.onStderrLine, (error) => {
      this.outputError = error
      this.terminator.terminate()
    })

    this.child.stdout.on("data", (chunk: Buffer) => {
      this.pushOutput(this.stdoutCollector, this.stdoutLines, chunk)
    })
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.pushOutput(this.stderrCollector, this.stderrLines, chunk)
    })

    if (deps.request.stdin !== undefined) {
      void this.endStdin(deps.request.stdin)
    }

    const timeout = deps.request.timeoutMs === undefined
      ? null
      : setTimeout(() => {
        this.timedOut = true
        this.terminator.terminate()
      }, deps.request.timeoutMs)

    const onAbort = () => {
      this.terminator.terminate()
    }
    if (deps.request.abortSignal?.aborted) {
      this.terminator.terminate()
    } else {
      deps.request.abortSignal?.addEventListener("abort", onAbort, { once: true })
    }

    this.waitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
      this.child.once("error", (error) => {
        this.spawnError = error
      })
      this.child.once("close", (code, signal) => {
        resolve({ code, signal })
      })
    }).then((closed) => {
      this.isAlive = false
      if (timeout) clearTimeout(timeout)
      this.terminator.clear()
      deps.request.abortSignal?.removeEventListener("abort", onAbort)
      return this.finish(closed)
    })
  }

  writeStdin(input: string | Uint8Array): Promise<void> {
    if (!this.isAlive) {
      return Promise.reject(new Error("Process session is not running"))
    }
    return new Promise((resolve, reject) => {
      this.child.stdin.write(input, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  }

  async endStdin(input?: string | Uint8Array): Promise<void> {
    if (input !== undefined) {
      await this.writeStdin(input)
    }
    await new Promise<void>((resolve) => {
      this.child.stdin.end(() => {
        resolve()
      })
    })
  }

  wait(): Promise<ControlledProcessResult> {
    return this.waitPromise
  }

  async close(signal: NodeJS.Signals = "SIGTERM"): Promise<ControlledProcessResult> {
    if (this.isAlive) {
      this.terminator.terminate(signal)
    }
    return this.wait()
  }

  alive(): boolean {
    return this.isAlive
  }

  private pushOutput(
    collector: OutputCollector,
    lineEmitter: LineEmitter,
    chunk: Buffer,
  ): void {
    try {
      collector.push(chunk)
      lineEmitter.push(chunk)
    } catch (error) {
      this.outputError = error as Error
      this.terminator.terminate()
    }
  }

  private finish(closed: {
    readonly code: number | null
    readonly signal: NodeJS.Signals | null
  }): ControlledProcessResult {
    try {
      this.stdoutLines.flush()
      this.stderrLines.flush()
    } catch (error) {
      this.outputError = error as Error
    }

    const stdout = this.stdoutCollector.text()
    const stderr = this.stderrCollector.text()
    const durationMs = Date.now() - this.startedAt
    const jsonLinesError = validateJsonLineOutput(this.output, {
      exitCode: closed.code,
      signal: closed.signal,
      stdout,
      stderr,
      stdoutTruncated: this.stdoutCollector.truncated(),
      stderrTruncated: this.stderrCollector.truncated(),
      timedOut: this.timedOut,
      durationMs,
      error: errorMessage(this.outputError) ?? errorMessage(this.spawnError),
    })
    const finalError = jsonLinesError ?? this.outputError
    const error = errorMessage(finalError) ?? errorMessage(this.spawnError)
    const result: ControlledProcessResult = {
      exitCode: closed.code,
      signal: closed.signal,
      stdout,
      stderr,
      stdoutTruncated: this.stdoutCollector.truncated(),
      stderrTruncated: this.stderrCollector.truncated(),
      timedOut: this.timedOut,
      durationMs,
      error,
    }
    const outcome = result.exitCode === 0 && !this.timedOut && !this.spawnError && !finalError
      ? "allowed"
      : "failed"

    this.auditSink.record({
      action: this.request.action,
      actor: this.request.actor,
      resource: this.request.command,
      outcome,
      metadata: {
        args: this.request.args ?? [],
        cwd: this.request.cwd,
        durationMs,
        exitCode: result.exitCode,
        signal: result.signal,
        timedOut: this.timedOut,
        error,
        longRunning: true,
        isolation: this.request.isolation,
        ...this.request.metadata,
      },
    })

    return result
  }
}

class OutputCollector {
  private readonly mode: ControlledProcessOutputMode
  private readonly maxBufferBytes: number
  private readonly overflow: "error" | "truncate"
  private readonly chunks: Buffer[] = []
  private bytes = 0
  private wasTruncated = false

  constructor(
    mode: ControlledProcessOutputMode,
    maxBufferBytes: number,
    overflow: "error" | "truncate",
  ) {
    this.mode = mode
    this.maxBufferBytes = maxBufferBytes
    this.overflow = overflow
  }

  push(chunk: Buffer): void {
    if (this.mode === "ignore") return
    const remaining = Math.max(0, this.maxBufferBytes - this.bytes)
    if (chunk.byteLength > remaining && this.overflow === "error") {
      throw new ControlledProcessOutputError(
        `Process output exceeded ${this.maxBufferBytes} bytes`,
      )
    }
    if (remaining > 0) {
      const accepted = chunk.byteLength > remaining ? chunk.subarray(0, remaining) : chunk
      this.chunks.push(accepted)
      this.bytes += accepted.byteLength
    }
    if (chunk.byteLength > remaining) this.wasTruncated = true
  }

  text(): string | undefined {
    if (this.mode === "ignore") return undefined
    const buffer = Buffer.concat(this.chunks)
    if (!this.wasTruncated) return buffer.toString("utf8")
    return new StringDecoder("utf8").write(buffer)
  }

  truncated(): boolean {
    return this.wasTruncated
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
  pathStrategy: PathStrategy = "merge",
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(envAllowlist ?? [])])
  const nextEnv: NodeJS.ProcessEnv = {}

  for (const key of allowlist) {
    if (!key) continue
    if (key === "PATH") {
      const userEntry = findEnvEntry(env, "PATH", platform)
      const shellPath = resolveCachedLoginShellPath()
      const fallbackPath = findEnvEntry(process.env, "PATH", platform)?.value ?? ""
      const delim = platform === "win32" ? ";" : ":"
      const caseInsensitive = platform === "win32"
      nextEnv.PATH = computePath(
        pathStrategy,
        userEntry?.value,
        shellPath,
        fallbackPath,
        delim,
        caseInsensitive,
      )
      continue
    }
    let entry = findEnvEntry(env, key, platform)
    if (!entry) entry = findEnvEntry(process.env, key, platform)
    if (entry) nextEnv[entry.key] = entry.value
  }

  return nextEnv
}

function buildPermissionContext(
  request: ControlledProcessRunRequest,
  args: readonly string[],
  output: ControlledProcessOutputOptions,
  options: { readonly longRunning?: boolean } = {},
): Record<string, unknown> {
  const launchPreview = previewLaunchForPermission(request, args)
  return {
    args,
    launchCommand: launchPreview.command,
    launchArgs: launchPreview.args,
    cwd: request.cwd,
    envKeys: buildPermissionEnvKeys(request.env, request.envAllowlist),
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
    ...(options.longRunning ? { longRunning: true } : undefined),
    isolation: launchPreview.isolationMetadata,
    ...request.metadata,
  }
}

function buildPermissionEnvKeys(
  env: Record<string, string | undefined> | undefined,
  envAllowlist: readonly string[] | undefined,
): string[] {
  const allowlist = new Set([...DEFAULT_ENV_ALLOWLIST, ...(envAllowlist ?? [])])
  const keys = new Set<string>()

  for (const key of allowlist) {
    if (!key) continue
    if (key === "PATH") {
      keys.add(findEnvEntry(env, "PATH")?.key ?? "PATH")
      continue
    }
    let entry = findEnvEntry(env, key)
    if (!entry) entry = findEnvEntry(process.env, key)
    if (entry) keys.add(entry.key)
  }

  return [...keys].sort()
}

function previewLaunchForPermission(
  request: ControlledProcessRunRequest,
  args: readonly string[],
): Pick<ControlledProcessLaunch, "command" | "args" | "isolationMetadata"> {
  const isolation = request.isolation
  if (isolation?.kind === "run_as_user" && process.platform !== "win32") {
    const user = isolation.user.trim()
    const envAllowlist = uniqueStrings(isolation.envAllowlist ?? DEFAULT_RUN_AS_ENV_ALLOWLIST)
    const preserveArg = envAllowlist.length > 0
      ? [`--preserve-env=${envAllowlist.join(",")}`]
      : []
    return {
      command: "sudo",
      args: [
        "-n",
        "-iu",
        user,
        ...preserveArg,
        "--",
        request.command,
        ...args,
      ],
      isolationMetadata: {
        kind: "run_as_user",
        user,
        envKeys: envAllowlist,
      },
    }
  }

  return {
    command: request.command,
    args,
    isolationMetadata: isolation ? { kind: isolation.kind } : undefined,
  }
}

function findEnvEntry(
  env: Record<string, string | undefined> | undefined,
  key: string,
  platform: NodeJS.Platform = process.platform,
): { key: string; value: string } | undefined {
  const exact = env?.[key]
  if (exact !== undefined) return { key, value: exact }
  if (!env || platform !== "win32") return undefined

  const lowered = key.toLowerCase()
  const actualKey = Object.keys(env).find((candidate) => candidate.toLowerCase() === lowered)
  if (!actualKey) return undefined

  const value = env[actualKey]
  return value === undefined ? undefined : { key: actualKey, value }
}

interface ControlledProcessLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly processGroup: boolean
  readonly isolationMetadata?: Record<string, unknown>
}

function buildLaunch(
  request: ControlledProcessRunRequest,
  options: {
    readonly platform?: NodeJS.Platform
    readonly fileExists?: (candidate: string) => boolean
  } = {},
): ControlledProcessLaunch {
  const platform = options.platform ?? process.platform
  const args = request.args ?? []
  const env = buildAllowedEnv(request.env, request.envAllowlist, request.pathStrategy ?? "merge", platform)
  const isolation = request.isolation
  if (!isolation) {
    return {
      ...wrapWindowsBatchCommand(resolveLaunchCommand(request.command, env, options), args, env, platform),
      env,
      processGroup: platform !== "win32",
    }
  }
  if (isolation.kind !== "run_as_user") {
    const exhaustive: never = isolation.kind
    throw new Error(`Unsupported process isolation: ${exhaustive}`)
  }
  if (platform === "win32") {
    throw new Error("run_as_user is not supported on Windows")
  }
  const user = isolation.user.trim()
  if (!user) {
    throw new Error("run_as_user requires a target user")
  }
  const envAllowlist = uniqueStrings(isolation.envAllowlist ?? DEFAULT_RUN_AS_ENV_ALLOWLIST)
  const isolatedEnv = filterEnv(env, envAllowlist)
  const preserveArg = envAllowlist.length > 0
    ? [`--preserve-env=${envAllowlist.join(",")}`]
    : []
  return {
    command: "sudo",
    args: [
      "-n",
      "-iu",
      user,
      ...preserveArg,
      "--",
      request.command,
      ...args,
    ],
    env: isolatedEnv,
    processGroup: true,
    isolationMetadata: {
      kind: "run_as_user",
      user,
      envKeys: Object.keys(isolatedEnv).sort(),
    },
  }
}

function resolveLaunchCommand(
  command: string,
  env: NodeJS.ProcessEnv,
  options: {
    readonly platform?: NodeJS.Platform
    readonly fileExists?: (candidate: string) => boolean
  },
): string {
  const platform = options.platform ?? process.platform
  if (platform !== "win32" || /[\\/]/u.test(command)) {
    return command
  }
  return resolveExecutableInPath(command, findEnvEntry(env, "PATH", platform)?.value, {
    platform,
    fileExists: options.fileExists,
    pathext: findEnvEntry(env, "PATHEXT", platform)?.value,
  }) ?? command
}

function wrapWindowsBatchCommand(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): Pick<ControlledProcessLaunch, "command" | "args"> {
  if (platform !== "win32" || !/\.(?:cmd|bat)$/i.test(command)) {
    return { command, args }
  }

  return {
    command: env.ComSpec ?? "cmd.exe",
    args: [
      "/d",
      "/s",
      "/c",
      [command, ...args].map(quoteWindowsCommandArg).join(" "),
    ],
  }
}

export function quoteWindowsCommandArg(value: string): string {
  if (value.length === 0) return "\"\""
  const escaped = value
    .replace(/\^/g, "^^")
    .replace(/"/g, "\"\"")
    .replace(/%/g, "%%")
    .replace(/[&()|<>]/g, "^$&")

  return /[\s&()^|<>"]/.test(value) ? `"${escaped}"` : escaped
}

function filterEnv(env: NodeJS.ProcessEnv, allowlist: readonly string[]): NodeJS.ProcessEnv {
  const nextEnv: NodeJS.ProcessEnv = {}
  for (const key of allowlist) {
    if (!key) continue
    const value = env[key]
    if (value !== undefined) nextEnv[key] = value
  }
  return nextEnv
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
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
