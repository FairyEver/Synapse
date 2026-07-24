import {
  parseStrictJson,
  SCRIPT_RESULT_MAX_BYTES,
  SCRIPT_SOURCE_MAX_BYTES,
  ScriptRuntimeError,
} from "../shared/json"
import { ScriptLogBuffer } from "./log-buffer"
import { ScriptStopSignal } from "./stop-signal"
import { serializeScriptInput } from "./strict-json-input"
import type { ScriptRunOutcome, ScriptRunRequest } from "./types"

type ElectronBrowserWindow = {
  readonly webContents: {
    executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>
    on(event: "console-message", listener: (...args: unknown[]) => void): void
  }
  loadURL(url: string): Promise<void>
  destroy(): void
  isDestroyed(): boolean
}

type ChromiumRunnerStage = "window_create" | "window_load" | "worker_execute" | "window_destroy"
type ScriptRuntimeDiagnosticLogger = {
  warn(message: string, details: {
    runner: "chromium"
    stage: ChromiumRunnerStage
    reason: "electron_error" | "unknown"
  }): void
}

export type ChromiumWorkerRunnerDeps = {
  readonly createWindow?: () => Promise<ElectronBrowserWindow>
  readonly logger?: ScriptRuntimeDiagnosticLogger
}

export const CHROMIUM_WORKER_WEB_PREFERENCES = {
  sandbox: true,
  nodeIntegration: false,
  contextIsolation: true,
  backgroundThrottling: false,
} as const

const CHROMIUM_START_ERROR = "Unable to start JavaScript execution."

class ChromiumRunnerInfrastructureError extends Error {
  readonly name = "ChromiumRunnerInfrastructureError"

  constructor(
    readonly stage: ChromiumRunnerStage,
    readonly causeValue: unknown,
  ) {
    super(CHROMIUM_START_ERROR)
  }
}

export async function runChromiumWorkerScript(
  request: ScriptRunRequest,
  deps: ChromiumWorkerRunnerDeps = {},
): Promise<ScriptRunOutcome> {
  const startedAt = Date.now()
  const logs = new ScriptLogBuffer()
  const stopSignal = new ScriptStopSignal()
  const destroyedWindows = new WeakSet<object>()
  let window: ElectronBrowserWindow | undefined

  const destroyWindow = (target = window): void => {
    if (!target || destroyedWindows.has(target)) return
    destroyedWindows.add(target)
    try {
      if (!target.isDestroyed()) target.destroy()
    } catch (destroyError) {
      logInfrastructureFailure(deps.logger, "window_destroy", destroyError)
    }
  }
  const stop = (code: "TIMEOUT" | "CANCELLED"): void => {
    stopSignal.request(code)
    destroyWindow()
  }
  const onAbort = () => stop("CANCELLED")
  request.abortSignal.addEventListener("abort", onAbort, { once: true })
  if (request.abortSignal.aborted) onAbort()
  const timer = setTimeout(
    () => stop("TIMEOUT"),
    request.timeoutSeconds * 1000,
  )

  try {
    stopSignal.throwIfStopped()
    assertMaxBytes(request.source, SCRIPT_SOURCE_MAX_BYTES, "Script source is too large.")
    const inputText = serializeScriptInput(request.input)

    try {
      window = await stopSignal.race(
        deps.createWindow ?? createSandboxedWindow,
        (lateWindow) => destroyWindow(lateWindow),
      )
    } catch (error) {
      if (error instanceof ScriptRuntimeError) throw error
      throw new ChromiumRunnerInfrastructureError("window_create", error)
    }

    window.webContents.on("console-message", (...args) => {
      const details = args.find((value) =>
        value !== null && typeof value === "object" && "message" in value) as { message?: unknown } | undefined
      const message = typeof details?.message === "string"
        ? details.message
        : args.find((value) => typeof value === "string") as string | undefined
      if (message) logs.append("console", message)
    })
    try {
      await stopSignal.race(() => window!.loadURL("about:blank"))
    } catch (error) {
      if (error instanceof ScriptRuntimeError) throw error
      throw new ChromiumRunnerInfrastructureError("window_load", error)
    }

    try {
      const completed = await stopSignal.race(
        () => window!.webContents.executeJavaScript(
          createWorkerExecutionSource(request.source, inputText),
          false,
        ),
      )
      stopSignal.throwIfStopped()

      const record = completed as { kind?: unknown; json?: unknown; error?: unknown }
      if (record.kind === "error") {
        if (record.error === "unsupported_value") {
          throw new ScriptRuntimeError(
            "INVALID_RESULT",
            "JavaScript result must be exactly one strict JSON value.",
            "unsupported_value",
          )
        }
        if (record.error === "output_too_large") {
          throw new ScriptRuntimeError("OUTPUT_TOO_LARGE", "JavaScript result exceeds the 1 MiB limit.")
        }
        throw new ScriptRuntimeError("SCRIPT_FAILED", "JavaScript execution failed.")
      }
      if (record.kind !== "result" || typeof record.json !== "string") {
        throw new ScriptRuntimeError("INVALID_RESULT", "JavaScript did not produce a valid result.", "missing")
      }
      assertMaxBytes(record.json, SCRIPT_RESULT_MAX_BYTES, "JavaScript result is too large.", "OUTPUT_TOO_LARGE")
      return {
        status: "success",
        result: parseStrictJson(record.json, "JavaScript result"),
        logs: logs.values(),
        durationMs: Date.now() - startedAt,
      }
    } catch (error) {
      if (error instanceof ScriptRuntimeError) throw error
      throw new ChromiumRunnerInfrastructureError("worker_execute", error)
    }
  } catch (error) {
    if (error instanceof ChromiumRunnerInfrastructureError) {
      logInfrastructureFailure(deps.logger, error.stage, error.causeValue)
    }
    const runtimeError = error instanceof ScriptRuntimeError
      ? error
      : new ScriptRuntimeError("RUNNER_START_FAILED", CHROMIUM_START_ERROR)
    const code = request.abortSignal.aborted || stopSignal.code === "CANCELLED"
      ? "CANCELLED"
      : stopSignal.code === "TIMEOUT"
        ? "TIMEOUT"
        : runtimeError.code
    return {
      status: code === "TIMEOUT" ? "timeout" : code === "CANCELLED" ? "cancelled" : "failed",
      code,
      error: code === "CANCELLED"
        ? "Script execution was cancelled."
        : code === "TIMEOUT"
          ? "Script execution timed out."
          : runtimeError.message,
      logs: logs.values(),
      durationMs: Date.now() - startedAt,
      ...(code === runtimeError.code && runtimeError.reason ? { reason: runtimeError.reason } : {}),
    }
  } finally {
    clearTimeout(timer)
    request.abortSignal.removeEventListener("abort", onAbort)
    destroyWindow()
  }
}

async function createSandboxedWindow(): Promise<ElectronBrowserWindow> {
  const { BrowserWindow, session } = await import("electron")
  const isolatedSession = session.fromPartition(`script-run:${crypto.randomUUID()}`, { cache: false })
  return new BrowserWindow({
    show: false,
    webPreferences: {
      ...CHROMIUM_WORKER_WEB_PREFERENCES,
      session: isolatedSession,
    },
  })
}

function createWorkerExecutionSource(source: string, serializedInput: string): string {
  return `new Promise((resolve) => {
    const source = ${JSON.stringify(source)};
    const prelude = \`
      (() => {
        const nativePostMessage = self.postMessage.bind(self);
        const validate = (value, seen = new Set()) => {
          if (value === null || typeof value === "string" || typeof value === "boolean") return;
          if (typeof value === "number") {
            if (!Number.isFinite(value)) throw new Error("unsupported");
            return;
          }
          if (typeof value !== "object" || seen.has(value)) throw new Error("unsupported");
          seen.add(value);
          const prototype = Object.getPrototypeOf(value);
          if (Array.isArray(value)) {
            for (let index = 0; index < value.length; index += 1) {
              if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error("unsupported");
              validate(value[index], seen);
            }
            const keys = Reflect.ownKeys(value);
            if (keys.some(key => key !== "length" && (typeof key !== "string" || !/^(0|[1-9]\\\\d*)$/.test(key)))) {
              throw new Error("unsupported");
            }
          } else {
            if (prototype !== Object.prototype && prototype !== null) throw new Error("unsupported");
            for (const key of Reflect.ownKeys(value)) {
              if (typeof key !== "string") throw new Error("unsupported");
              const descriptor = Object.getOwnPropertyDescriptor(value, key);
              if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) throw new Error("unsupported");
              validate(descriptor.value, seen);
            }
          }
          seen.delete(value);
        };
        Object.defineProperty(self, "postMessage", {
          configurable: true,
          writable: true,
          value(value) {
            try {
              validate(value);
              const json = JSON.stringify(value);
              if (new TextEncoder().encode(json).byteLength > ${SCRIPT_RESULT_MAX_BYTES}) {
                nativePostMessage({ __synapseScriptResult: true, kind: "error", error: "output_too_large" });
                return;
              }
              nativePostMessage({ __synapseScriptResult: true, kind: "result", json });
            } catch {
              nativePostMessage({ __synapseScriptResult: true, kind: "error", error: "unsupported_value" });
            }
          }
        });
      })();
      self.addEventListener("unhandledrejection", event => {
        event.preventDefault();
        throw event.reason instanceof Error ? event.reason : new Error("Unhandled rejection");
      });
    \`;
    const blob = new Blob([prelude, source], { type: "text/javascript" });
    const worker = new Worker(URL.createObjectURL(blob));
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      worker.terminate();
      resolve(value);
    };
    worker.onmessage = (event) => {
      try {
        const message = event.data;
        if (!message || message.__synapseScriptResult !== true) throw new Error("unsupported");
        finish(message);
      } catch {
        finish({ kind: "error", error: "unsupported_value" });
      }
    };
    worker.onerror = () => finish({ kind: "error", error: "script_failed" });
    worker.postMessage(JSON.parse(${JSON.stringify(serializedInput)}));
  })`
}

function assertMaxBytes(
  value: string,
  maxBytes: number,
  message: string,
  code: "INVALID_INPUT" | "OUTPUT_TOO_LARGE" = "INVALID_INPUT",
): void {
  if (Buffer.byteLength(value, "utf8") > maxBytes) {
    throw new ScriptRuntimeError(code, message)
  }
}

function logInfrastructureFailure(
  logger: ScriptRuntimeDiagnosticLogger | undefined,
  stage: ChromiumRunnerStage,
  error: unknown,
): void {
  logger?.warn("script runner infrastructure failure", {
    runner: "chromium",
    stage,
    reason: error instanceof Error ? "electron_error" : "unknown",
  })
}
