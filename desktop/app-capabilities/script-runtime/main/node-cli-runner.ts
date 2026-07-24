import { spawn, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { constants } from "node:fs"
import { access, open, unlink } from "node:fs/promises"
import { join } from "node:path"
import { StringDecoder } from "node:string_decoder"

import {
  parseStrictJson,
  SCRIPT_RESULT_MAX_BYTES,
  SCRIPT_SOURCE_MAX_BYTES,
  ScriptRuntimeError,
} from "../shared/json"
import { ScriptLogBuffer } from "./log-buffer"
import { ScriptStopSignal } from "./stop-signal"
import { serializeScriptInput } from "./strict-json-input"
import type { NodeScriptRunRequest, ScriptRunOutcome } from "./types"

type NodeRunnerStage =
  | "cwd_access"
  | "temp_create"
  | "temp_write"
  | "temp_sync"
  | "temp_close"
  | "spawn"
  | "stdin"
  | "stdout"
  | "stderr"
  | "cleanup_process"
  | "cleanup_temp"

type ScriptRuntimeDiagnosticLogger = {
  warn(message: string, details: { runner: "node"; stage: NodeRunnerStage; reason: string }): void
}

export type NodeCliRunnerDeps = {
  readonly executablePath: string
  readonly baseEnv: NodeJS.ProcessEnv
  readonly platform?: NodeJS.Platform
  readonly spawnProcess?: typeof spawn
  readonly accessPath?: typeof access
  readonly openFile?: typeof open
  readonly unlinkFile?: typeof unlink
  readonly terminateProcess?: (child: ChildProcess, platform: NodeJS.Platform) => Promise<void>
  readonly logger?: ScriptRuntimeDiagnosticLogger
}

const NODE_RUNNER_PRELOAD_URL = `data:text/javascript,${encodeURIComponent(`
  delete process.env.ELECTRON_RUN_AS_NODE;
  const importIndex = process.execArgv.findIndex((value) => value === "--import");
  if (importIndex >= 0) process.execArgv.splice(importIndex, 2);
`)}`
const NODE_START_ERROR = "Unable to start Node.js script execution."
const NODE_IO_ERROR = "Node.js process I/O failed."
const CLEANUP_WAIT_MS = 100

class NodeRunnerInfrastructureError extends Error {
  readonly name = "NodeRunnerInfrastructureError"

  constructor(
    readonly stage: NodeRunnerStage,
    readonly causeValue: unknown,
  ) {
    super(NODE_START_ERROR)
  }
}

export async function runNodeCliScript(
  request: NodeScriptRunRequest,
  deps: NodeCliRunnerDeps,
): Promise<ScriptRunOutcome> {
  const startedAt = Date.now()
  const logs = new ScriptLogBuffer()
  const platform = deps.platform ?? process.platform
  const terminate = deps.terminateProcess ?? terminateProcessTree
  const stopSignal = new ScriptStopSignal()
  let tempPath: string | undefined
  let child: ChildProcess | undefined
  let terminationPromise: Promise<void> | undefined

  const stopChild = (): void => {
    if (!child || child.exitCode !== null || terminationPromise) return
    terminationPromise = Promise.resolve()
      .then(() => terminate(child!, platform))
      .catch((error) => {
        logInfrastructureFailure(deps.logger, "cleanup_process", error)
      })
  }
  const requestStop = (code: "TIMEOUT" | "CANCELLED"): void => {
    stopSignal.request(code)
    stopChild()
  }
  const onAbort = () => requestStop("CANCELLED")
  request.abortSignal.addEventListener("abort", onAbort, { once: true })
  if (request.abortSignal.aborted) requestStop("CANCELLED")
  const timer = setTimeout(
    () => requestStop("TIMEOUT"),
    request.timeoutSeconds * 1000,
  )

  try {
    stopSignal.throwIfStopped()
    assertByteLimit(request.source, SCRIPT_SOURCE_MAX_BYTES, "Script source is too large.")
    const inputText = serializeScriptInput(request.input)

    try {
      await stopSignal.race(
        () => (deps.accessPath ?? access)(request.cwd, constants.R_OK | constants.W_OK),
      )
    } catch (error) {
      if (error instanceof ScriptRuntimeError) throw error
      throw new NodeRunnerInfrastructureError("cwd_access", error)
    }

    tempPath = await writeTemporaryScript(
      request.cwd,
      request.moduleMode,
      request.source,
      deps,
      stopSignal,
    )

    try {
      child = (deps.spawnProcess ?? spawn)(
        deps.executablePath,
        ["--import", NODE_RUNNER_PRELOAD_URL, tempPath],
        {
          cwd: request.cwd,
          env: {
            ...deps.baseEnv,
            ELECTRON_RUN_AS_NODE: "1",
          },
          detached: platform !== "win32",
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
    } catch (error) {
      throw new NodeRunnerInfrastructureError("spawn", error)
    }
    stopSignal.throwIfStopped()

    const outcome = await waitForChild({
      child,
      inputText,
      logs,
      startedAt,
      stopSignal,
      terminateChild: stopChild,
      logger: deps.logger,
    })
    stopSignal.throwIfStopped()
    return outcome
  } catch (error) {
    if (error instanceof NodeRunnerInfrastructureError) {
      logInfrastructureFailure(deps.logger, error.stage, error.causeValue)
    }
    const runtimeError = error instanceof ScriptRuntimeError
      ? error
      : new ScriptRuntimeError("RUNNER_START_FAILED", NODE_START_ERROR)
    const code = request.abortSignal.aborted || stopSignal.code === "CANCELLED"
      ? "CANCELLED"
      : stopSignal.code === "TIMEOUT"
        ? "TIMEOUT"
        : runtimeError.code
    return {
      status: code === "CANCELLED" ? "cancelled" : code === "TIMEOUT" ? "timeout" : "failed",
      code,
      error: code === "CANCELLED"
        ? "Script execution was cancelled."
        : code === "TIMEOUT"
          ? "Script execution timed out."
          : runtimeError.message,
      logs: logs.values(),
      durationMs: Date.now() - startedAt,
      exitCode: child?.exitCode,
      ...(code === runtimeError.code && runtimeError.reason ? { reason: runtimeError.reason } : {}),
    }
  } finally {
    clearTimeout(timer)
    request.abortSignal.removeEventListener("abort", onAbort)
    if (child && child.exitCode === null) {
      stopChild()
    }
    if (tempPath) {
      await waitBounded(
        removeTemporaryPath(tempPath, deps),
        CLEANUP_WAIT_MS,
      )
      if (terminationPromise) {
        void terminationPromise.then(() => removeTemporaryPath(tempPath!, deps))
      }
    }
  }
}

async function waitForChild(options: {
  readonly child: ChildProcess
  readonly inputText: string
  readonly logs: ScriptLogBuffer
  readonly startedAt: number
  readonly stopSignal: ScriptStopSignal
  readonly terminateChild: () => void
  readonly logger?: ScriptRuntimeDiagnosticLogger
}): Promise<ScriptRunOutcome> {
  const {
    child,
    inputText,
    logs,
    startedAt,
    stopSignal,
    terminateChild,
    logger,
  } = options

  return new Promise<ScriptRunOutcome>((resolve) => {
    let settled = false
    let stdoutBytes = 0
    const stdoutChunks: Buffer[] = []
    const stderrDecoder = new StringDecoder("utf8")

    const finish = (value: ScriptRunOutcome) => {
      if (settled) return
      settled = true
      child.stderr?.off("data", onStderrData)
      resolve(value)
    }
    const onStderrData = (chunk: Buffer) => {
      if (settled) return
      const decoded = stderrDecoder.write(chunk)
      if (decoded) logs.append("stderr", decoded)
    }
    const failIo = (stage: "stdin" | "stdout" | "stderr", error: unknown) => {
      if (settled) return
      logInfrastructureFailure(logger, stage, error)
      terminateChild()
      finish({
        status: "failed",
        code: "RUNNER_START_FAILED",
        error: NODE_IO_ERROR,
        logs: logs.values(),
        durationMs: Date.now() - startedAt,
        exitCode: child.exitCode,
      })
    }
    const finishStopped = (code: "TIMEOUT" | "CANCELLED") => {
      finish({
        status: code === "TIMEOUT" ? "timeout" : "cancelled",
        code,
        error: code === "TIMEOUT"
          ? "Script execution timed out."
          : "Script execution was cancelled.",
        logs: logs.values(),
        durationMs: Date.now() - startedAt,
        exitCode: child.exitCode,
      })
    }

    void stopSignal.promise.then(finishStopped)

    child.once("error", (error) => {
      logInfrastructureFailure(logger, "spawn", error)
      finish({
        status: "failed",
        code: "RUNNER_START_FAILED",
        error: NODE_START_ERROR,
        logs: logs.values(),
        durationMs: Date.now() - startedAt,
      })
    })
    if (!child.stdin || !child.stdout || !child.stderr) {
      failIo("stdin", { code: "EPIPE" })
      return
    }
    child.stdout.on("error", (error) => failIo("stdout", error))
    child.stderr.on("error", (error) => failIo("stderr", error))
    child.stdin.on("error", (error) => failIo("stdin", error))
    child.stdout.on("data", (chunk: Buffer) => {
      if (settled) return
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > SCRIPT_RESULT_MAX_BYTES) {
        terminateChild()
        finish({
          status: "failed",
          code: "OUTPUT_TOO_LARGE",
          error: "Script stdout exceeds the 1 MiB result limit.",
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode: child.exitCode,
        })
        return
      }
      stdoutChunks.push(chunk)
    })
    child.stderr.on("data", onStderrData)
    child.once("close", (exitCode, signal) => {
      if (settled) return
      const stderrTail = stderrDecoder.end()
      if (stderrTail) logs.append("stderr", stderrTail)
      const stopCode = stopSignal.code
      if (stopCode) {
        finishStopped(stopCode)
        return
      }
      if (exitCode !== 0) {
        finish({
          status: "failed",
          code: "SCRIPT_FAILED",
          error: signal
            ? `Node.js exited with signal ${signal}.`
            : `Node.js exited with code ${exitCode ?? "unknown"}.`,
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode,
        })
        return
      }

      let stdout: string
      try {
        stdout = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(stdoutChunks))
      } catch {
        finish({
          status: "failed",
          code: "INVALID_RESULT",
          error: "Node.js stdout is not valid UTF-8.",
          reason: "invalid_json",
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode: 0,
        })
        return
      }
      if (!stdout.trim()) {
        finish({
          status: "failed",
          code: "INVALID_RESULT",
          error: "Node.js stdout did not contain a JSON result.",
          reason: "missing",
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode: 0,
        })
        return
      }
      try {
        const result = parseStrictJson(stdout, "Node.js stdout")
        finish({
          status: "success",
          result,
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode: 0,
        })
      } catch (error) {
        const runtimeError = error instanceof ScriptRuntimeError
          ? error
          : new ScriptRuntimeError("INVALID_RESULT", "Node.js stdout is not valid JSON.")
        finish({
          status: "failed",
          code: runtimeError.code,
          error: runtimeError.message,
          ...(runtimeError.reason ? { reason: runtimeError.reason } : {}),
          logs: logs.values(),
          durationMs: Date.now() - startedAt,
          exitCode: 0,
        })
      }
    })

    try {
      child.stdin.end(inputText)
    } catch (error) {
      failIo("stdin", error)
    }
  })
}

async function writeTemporaryScript(
  cwd: string,
  moduleMode: "commonjs" | "esm",
  source: string,
  deps: NodeCliRunnerDeps,
  stopSignal: ScriptStopSignal,
): Promise<string> {
  const extension = moduleMode === "esm" ? "mjs" : "cjs"
  const openFile = deps.openFile ?? open
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const path = join(cwd, `.synapse-node-${randomBytes(12).toString("hex")}.${extension}`)
    let handle: Awaited<ReturnType<typeof open>> | undefined
    const cleanup = createTemporaryFileCleanup(path, deps)
    const scheduleCleanup = (
      cleanupHandle: Awaited<ReturnType<typeof open>> | undefined = handle,
    ): void => {
      cleanup.schedule(cleanupHandle)
    }
    try {
      try {
        handle = await stopSignal.race(
          () => openFile(path, "wx", 0o600),
          (lateHandle) => scheduleCleanup(lateHandle),
          scheduleCleanup,
        )
      } catch (error) {
        if (error instanceof ScriptRuntimeError) {
          scheduleCleanup()
          throw error
        }
        if ((error as NodeJS.ErrnoException).code === "EEXIST") continue
        throw new NodeRunnerInfrastructureError("temp_create", error)
      }
      try {
        await stopSignal.race(
          () => handle!.writeFile(source, "utf8"),
          () => scheduleCleanup(),
          scheduleCleanup,
        )
      } catch (error) {
        if (error instanceof ScriptRuntimeError) {
          scheduleCleanup()
          throw error
        }
        throw new NodeRunnerInfrastructureError("temp_write", error)
      }
      try {
        await stopSignal.race(
          () => handle!.sync(),
          () => scheduleCleanup(),
          scheduleCleanup,
        )
      } catch (error) {
        if (error instanceof ScriptRuntimeError) {
          scheduleCleanup()
          throw error
        }
        throw new NodeRunnerInfrastructureError("temp_sync", error)
      }
      try {
        await stopSignal.race(
          () => handle!.close(),
          () => scheduleCleanup(),
          scheduleCleanup,
        )
        handle = undefined
      } catch (error) {
        if (error instanceof ScriptRuntimeError) {
          scheduleCleanup()
          throw error
        }
        throw new NodeRunnerInfrastructureError("temp_close", error)
      }
      stopSignal.throwIfStopped()
      return path
    } catch (error) {
      scheduleCleanup()
      throw error
    }
  }
  throw new NodeRunnerInfrastructureError("temp_create", { code: "EEXIST" })
}

async function terminateProcessTree(child: ChildProcess, platform: NodeJS.Platform): Promise<void> {
  if (child.exitCode !== null || !child.pid) return
  if (platform === "win32") {
    const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    })
    const completed = await waitForExit(killer, 500)
    if (!completed) killer.kill("SIGKILL")
    if (!completed || killer.exitCode !== 0) child.kill("SIGKILL")
    return
  }
  try {
    process.kill(-child.pid, "SIGTERM")
  } catch {
    child.kill("SIGTERM")
  }
  await waitForExit(child, 500)
  if (child.exitCode !== null) return
  try {
    process.kill(-child.pid, "SIGKILL")
  } catch {
    child.kill("SIGKILL")
  }
}

function waitForExit(child: ChildProcess, milliseconds: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), milliseconds)
    child.once("close", () => {
      clearTimeout(timer)
      resolve(true)
    })
    child.once("error", () => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

function createTemporaryFileCleanup(
  path: string,
  deps: NodeCliRunnerDeps,
): {
  readonly schedule: (handle?: Awaited<ReturnType<typeof open>>) => void
} {
  const closingHandles = new WeakSet<object>()
  let initialRemovalStarted = false
  const startInitialRemoval = (): void => {
    if (initialRemovalStarted) return
    initialRemovalStarted = true
    void removeTemporaryPath(path, deps)
  }
  return {
    schedule(handle) {
      startInitialRemoval()
      if (!handle || closingHandles.has(handle)) return
      closingHandles.add(handle)
      void Promise.resolve()
        .then(() => handle.close())
        .catch((error) => {
          logInfrastructureFailure(deps.logger, "temp_close", error)
        })
        .then(() => removeTemporaryPath(path, deps))
    },
  }
}

async function removeTemporaryPath(path: string, deps: NodeCliRunnerDeps): Promise<boolean> {
  try {
    await (deps.unlinkFile ?? unlink)(path)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return true
    logInfrastructureFailure(deps.logger, "cleanup_temp", error)
    return false
  }
}

async function waitBounded(operation: Promise<unknown>, milliseconds: number): Promise<void> {
  await Promise.race([
    operation,
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
  ])
}

function assertByteLimit(value: string, maxBytes: number, message: string): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ScriptRuntimeError("INVALID_INPUT", message)
  }
}

function logInfrastructureFailure(
  logger: ScriptRuntimeDiagnosticLogger | undefined,
  stage: NodeRunnerStage,
  error: unknown,
): void {
  logger?.warn("script runner infrastructure failure", {
    runner: "node",
    stage,
    reason: infrastructureReason(error),
  })
}

function infrastructureReason(error: unknown): string {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : ""
  switch (code) {
    case "ENOENT": return "not_found"
    case "ENOTDIR": return "not_directory"
    case "EACCES":
    case "EPERM": return "permission_denied"
    case "EEXIST": return "already_exists"
    case "EIO": return "io"
    case "EPIPE": return "pipe"
    default: return "unknown"
  }
}
